import { beforeAll, describe, expect, it, vi } from "vitest";
// Initializes the wasm the draft repo's slim automerge shares.
import "@automerge/automerge";
import {
  Repo,
  encodeHeads,
  initSubduction,
  type AutomergeUrl,
} from "@automerge/automerge-repo";
import { request, subscribe } from "@inkandswitch/patchwork-providers";

import type {
  DraftDoc,
  DraftSelection,
  HasWorkspaceCheckouts,
  WorkspaceCheckoutsDoc,
} from "../draft-types";

vi.mock("@inkandswitch/patchwork-plugins", () => import("../test-registry"));

const { DraftProvider } = await import("./DraftProvider");

type Note = {
  "@patchwork": { type: string; mainDraftUrl?: AutomergeUrl };
  text: string;
};

function setup() {
  const repo = new Repo({});
  const note = repo.create<Note>({ "@patchwork": { type: "note" }, text: "main" });
  const clone = repo.clone(note);
  clone.change((d) => {
    d.text = "draft";
  });
  const main = repo.create<DraftDoc>({
    "@patchwork": { type: "draft" },
    isMain: true,
    parent: note.url,
    drafts: [],
    clones: {},
  });
  const draft = repo.create<DraftDoc>({
    "@patchwork": { type: "draft" },
    parent: main.url,
    drafts: [],
    clones: { [note.url]: { cloneUrl: clone.url, clonedAt: note.heads() } },
  });
  main.change((d) => {
    d.drafts.push(draft.url);
  });
  note.change((d) => {
    d["@patchwork"].mainDraftUrl = main.url;
  });
  const account = repo.create<HasWorkspaceCheckouts>({});
  return { repo, note, draft, account };
}

function mount(repo: Repo, attributes: Record<string, string>) {
  const element = document.createElement("div") as HTMLElement & {
    repo?: Repo;
  };
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  const child = element.appendChild(document.createElement("div"));
  document.body.append(element);
  const dispose = DraftProvider(element, repo);
  return { element, child, dispose };
}

function select(
  element: HTMLElement,
  checkedOut: AutomergeUrl | null
): Promise<DraftSelection> {
  return request<DraftSelection>(element, {
    type: "draft:select",
    checkedOut,
    at: null,
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeAll(() => initSubduction());

describe("DraftProvider", () => {
  it("keeps the selection in memory and writes nothing while on main", async () => {
    const { repo, note, account } = setup();
    const before = Object.keys(repo.handles).length;
    const { child, dispose } = mount(repo, {
      "doc-url": note.url,
      "account-url": account.url,
    });

    const seen: DraftSelection[] = [];
    const stop = subscribe<DraftSelection>(
      child,
      { type: "draft:selection" },
      (value) => seen.push(value)
    );
    const at = { [note.url]: { from: encodeHeads([]) } };
    await request(child, { type: "draft:select", checkedOut: null, at });
    await settle();

    expect(seen.at(-1)).toEqual({ checkedOut: null, at });
    expect(Object.keys(repo.handles)).toHaveLength(before);
    expect(account.doc()?.workspaceCheckoutsUrl).toBeUndefined();
    stop();
    dispose();
  });

  it("remembers a checked-out draft in the account and opens on it next time", async () => {
    const { repo, note, draft, account } = setup();
    const first = mount(repo, {
      "doc-url": note.url,
      "account-url": account.url,
    });
    await select(first.child, draft.url);
    await settle();

    expect(first.element.getAttribute("draft-url")).toBe(draft.url);
    const checkoutsUrl = account.doc()?.workspaceCheckoutsUrl;
    expect(checkoutsUrl).toBeDefined();
    const checkouts = await repo.find<WorkspaceCheckoutsDoc>(checkoutsUrl!);
    expect(checkouts.doc()?.checkedOut).toEqual({ [note.url]: draft.url });
    first.dispose();

    const second = mount(repo, {
      "doc-url": note.url,
      "account-url": account.url,
    });
    const handle = await second.element.repo!.find<Note>(note.url);
    expect(handle.doc()?.text).toBe("draft");
    second.dispose();
  });

  it("forgets the draft when main is checked out again", async () => {
    const { repo, note, draft, account } = setup();
    const { child, dispose } = mount(repo, {
      "doc-url": note.url,
      "account-url": account.url,
    });
    await select(child, draft.url);
    await settle();
    await select(child, null);
    await settle();

    const checkouts = await repo.find<WorkspaceCheckoutsDoc>(
      account.doc()!.workspaceCheckoutsUrl!
    );
    expect(checkouts.doc()?.checkedOut).toEqual({});
    dispose();
  });

  it("pins a realm to the draft in its url attribute", async () => {
    const { repo, note, draft } = setup();
    const { element, dispose } = mount(repo, { url: draft.url });
    const handle = await element.repo!.find<Note>(note.url);
    expect(handle.doc()?.text).toBe("draft");
    expect(element.getAttribute("draft-url")).toBe(draft.url);
    dispose();
  });
});
