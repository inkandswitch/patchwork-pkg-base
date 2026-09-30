import { describe, expect, it, vi } from "vitest";
import { ImmutableString } from "@automerge/automerge";
import {
  generateAutomergeUrl,
  type AutomergeUrl,
  type Repo,
} from "@automerge/automerge-repo";

// The real package pulls in keyhive, which only the host's importmap provides.
const datatypes = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@inkandswitch/patchwork-plugins", () => ({
  getRegistry: () => ({
    load: async (id: string) =>
      datatypes.has(id) ? { id, module: datatypes.get(id) } : undefined,
  }),
}));

import {
  collectDraftMembers,
  defaultEmbeddedDocuments,
  getEmbeddedDocuments,
  trackMembership,
} from "./draft-membership";

describe("collectDraftMembers", () => {
  it("walks every reachable doc once, through cycles", async () => {
    const docs = new FakeRepo();
    const [a, b, c] = [newUrl(), newUrl(), newUrl()];
    docs.set(a, { next: b });
    docs.set(b, { back: a, also: c });
    docs.set(c, { text: `see ${a} and ${b}.` });

    const members = await collectDraftMembers([a], docs.read);
    expect(members).toEqual([a, b, c]);
  });

  it("leaves contacts out and doesn't walk through them", async () => {
    const docs = new FakeRepo();
    const [message, contact, avatar] = [newUrl(), newUrl(), newUrl()];
    docs.set(message, { contactUrl: contact, text: "hi" });
    docs.set(contact, { "@patchwork": { type: "contact" }, avatarUrl: avatar });
    docs.set(avatar, {});

    expect(await collectDraftMembers([message], docs.read)).toEqual([message]);
  });

  it("collapses sub-urls and pinned urls onto their document", async () => {
    const docs = new FakeRepo();
    const [parent, child] = [newUrl(), newUrl()];
    docs.set(parent, {
      sub: `${child}/items/@0`,
      pinned: `${child}#2j9knpCseyhnK8izDmLpGP5WMdZQ`,
    });
    docs.set(child, {});

    expect(await collectDraftMembers([parent], docs.read)).toEqual([
      parent,
      child,
    ]);
  });

  it("expands roots but not docs it already knows", async () => {
    const docs = new FakeRepo();
    const [root, known, fresh] = [newUrl(), newUrl(), newUrl()];
    docs.set(root, { known });
    docs.set(known, { fresh });
    docs.set(fresh, {});

    const members = await collectDraftMembers([root], docs.read, {
      known: new Set([root, known]),
    });
    expect(members).toEqual([root]);
  });

  it("skips docs that fail to load", async () => {
    const docs = new FakeRepo();
    const [root, missing] = [newUrl(), newUrl()];
    docs.set(root, { missing });

    expect(await collectDraftMembers([root], docs.read)).toEqual([root]);
  });
});

describe("defaultEmbeddedDocuments", () => {
  const url = newUrl();
  const other = newUrl();

  it("finds urls in any string, trimming trailing punctuation", () => {
    expect(defaultEmbeddedDocuments({ note: `link: ${url}.` })).toEqual([url]);
    expect(defaultEmbeddedDocuments({ list: [[`(${url})`]] })).toEqual([url]);
  });

  it("skips @patchwork subtrees at any depth", () => {
    const doc = {
      "@patchwork": { type: "essay", mainDraftUrl: other },
      threads: [{ "@patchwork": { copyOf: other }, ref: url }],
    };
    expect(defaultEmbeddedDocuments(doc)).toEqual([url]);
  });

  it("never looks inside bytes or immutable strings", () => {
    const doc = {
      content: new TextEncoder().encode(other),
      bundle: new ImmutableString(`const x = "${other}"`),
      link: url,
    };
    expect(defaultEmbeddedDocuments(doc)).toEqual([url]);
  });
});

describe("getEmbeddedDocuments", () => {
  it("defers to the datatype's getEmbeddedDocuments", async () => {
    const [kept, shared] = [newUrl(), newUrl()];
    datatypes.set("test-embedding", {
      init() {},
      getTitle: () => "Test",
      getEmbeddedDocuments: (doc: { kept: AutomergeUrl }) => [doc.kept],
    });

    const doc = { "@patchwork": { type: "test-embedding" }, kept, shared };
    expect(await getEmbeddedDocuments(doc)).toEqual([kept]);
  });

  it("uses the default scan for unregistered types", async () => {
    const url = newUrl();
    const doc = { "@patchwork": { type: "nobody-registered-this" }, url };
    expect(await getEmbeddedDocuments(doc)).toEqual([url]);
  });
});

describe("trackMembership", () => {
  it("admits docs a member links to after tracking starts", async () => {
    const docs = new FakeRepo();
    const [root, linked] = [newUrl(), newUrl()];
    docs.set(root, { links: [] as AutomergeUrl[] });
    docs.set(linked, {});

    const added: AutomergeUrl[] = [];
    const tracker = trackMembership({
      repo: docs.asRepo(),
      roots: [root],
      backingUrl: (url) => url,
      onAdded: (urls) => {
        added.push(...urls);
      },
    });
    await tracker.settled();
    expect(added).toEqual([root]);

    docs.change(root, { links: [linked] });
    await tracker.settled();
    expect(added).toEqual([root, linked]);
    tracker.dispose();
  });

  it("doesn't report known members as added", async () => {
    const docs = new FakeRepo();
    const [root, known] = [newUrl(), newUrl()];
    docs.set(root, { known });
    docs.set(known, {});

    const added: AutomergeUrl[] = [];
    const tracker = trackMembership({
      repo: docs.asRepo(),
      roots: [root],
      known: [root, known],
      backingUrl: (url) => url,
      onAdded: (urls) => {
        added.push(...urls);
      },
    });
    await tracker.settled();
    expect(added).toEqual([]);
    tracker.dispose();
  });
});

function newUrl(): AutomergeUrl {
  return generateAutomergeUrl();
}

// Just enough of a repo for the walker: `find` and `change` events.
class FakeRepo {
  #docs = new Map<AutomergeUrl, unknown>();
  #listeners = new Map<AutomergeUrl, Set<() => void>>();

  set(url: AutomergeUrl, doc: unknown): void {
    this.#docs.set(url, doc);
  }

  change(url: AutomergeUrl, doc: unknown): void {
    this.#docs.set(url, doc);
    for (const listener of this.#listeners.get(url) ?? []) listener();
  }

  read = async (url: AutomergeUrl): Promise<unknown> => {
    if (!this.#docs.has(url)) throw new Error(`unavailable: ${url}`);
    return this.#docs.get(url);
  };

  asRepo(): Repo {
    const find = async (url: AutomergeUrl) => {
      await this.read(url);
      return {
        doc: () => this.#docs.get(url),
        on: (_event: string, listener: () => void) => {
          if (!this.#listeners.has(url)) this.#listeners.set(url, new Set());
          this.#listeners.get(url)!.add(listener);
        },
        off: (_event: string, listener: () => void) => {
          this.#listeners.get(url)?.delete(listener);
        },
      };
    };
    return { find } as unknown as Repo;
  }
}
