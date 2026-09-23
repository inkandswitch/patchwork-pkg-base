// `repo.clone` shares nested materialized JS objects between the source doc
// and its clone; Solid stores (`reconcile`) mutate those raw objects in place.
// Drafts creates exactly this pairing: main and its per-draft clones live in
// one repo (DraftOverlayProvider `resolveClone`), and the sidebar mirrors main
// into a `subscribeDoc` store (DraftsSidebar `draft:root-doc`). A change to
// main then leaks into the clone's `doc()` without the clone ever changing.
// See https://github.com/chee/solid-automerge/pull/8.
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  Repo,
  initSubduction,
  type AutomergeUrl,
  type DocHandle,
  type PeerId,
} from "@automerge/automerge-repo";
import {
  subscribe,
  type DocHandleDescriptor,
} from "@inkandswitch/patchwork-providers";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";

import { DraftStateProvider } from "./providers/DraftStateProvider";
import { DraftOverlayProvider } from "./providers/DraftOverlayProvider";
import { renderDraftsSidebar } from "./main";
import type {
  CheckedOutDraft,
  DraftDoc,
  HasDrafts,
} from "./draft-types";

type HostDoc = HasDrafts & { array: number[]; title: string };

type Env = {
  repo: Repo;
  host: DocHandle<HostDoc>;
  overlayEl: HTMLElement;
  sidebarEl: ToolElement;
  disposers: (() => void)[];
};

function setup(): Env {
  const repo = new Repo({ peerId: "bob" as PeerId });
  (window as unknown as { repo?: Repo }).repo = repo;

  const host = repo.create<HostDoc>({
    "@patchwork": { type: "note" },
    title: "hello",
    array: [1, 2, 3],
  });

  const stateEl = document.createElement("div");
  stateEl.setAttribute("doc-url", host.url);
  const overlayEl = document.createElement("div");
  const sidebarEl = document.createElement("div") as unknown as ToolElement;
  sidebarEl.repo = repo;
  stateEl.appendChild(overlayEl);
  overlayEl.appendChild(sidebarEl);
  document.body.appendChild(stateEl);

  const disposers = [DraftStateProvider(stateEl), DraftOverlayProvider(overlayEl)];
  return { repo, host, overlayEl, sidebarEl, disposers };
}

// What an editor's `OverlayRepo.find(hostUrl)` does beneath the overlay: a
// live descriptor subscription that flips to `{ url, cloneUrl }` on a draft.
function watchDescriptor(env: Env, url: AutomergeUrl) {
  let latest: DocHandleDescriptor | undefined;
  const unsubscribe = subscribe<DocHandleDescriptor>(
    env.sidebarEl,
    { type: "repo:handle-descriptor", url },
    (d) => (latest = d)
  );
  env.disposers.push(unsubscribe);
  return () => latest;
}

async function waitForClone(env: Env, descriptor: () => DocHandleDescriptor | undefined) {
  await vi.waitFor(() => expect(descriptor()?.cloneUrl).toBeDefined(), 5000);
  return env.repo.find<HostDoc>(descriptor()!.cloneUrl!);
}

describe("draft clones vs. main", () => {
  beforeAll(() => initSubduction());
  let env: Env;
  beforeEach(() => {
    env = setup();
  });
  afterEach(() => {
    for (const dispose of env.disposers.reverse()) dispose();
    delete (window as unknown as { repo?: Repo }).repo;
    document.body.innerHTML = "";
    history.replaceState(null, "", "#");
  });

  it("control: with only the providers, a change to main does not reach the clone", async () => {
    const { repo, host, overlayEl } = env;
    const descriptor = watchDescriptor(env, host.url);

    // Wait for the state provider to create the main draft, then hang a draft
    // off it so the router treats the selection as available.
    await vi.waitFor(() =>
      expect(host.doc()["@patchwork"]?.mainDraftUrl).toBeDefined()
    );
    const mainDraft = await repo.find<DraftDoc>(
      host.doc()["@patchwork"]!.mainDraftUrl!
    );
    const draft = repo.create<DraftDoc>({
      "@patchwork": { type: "draft" },
      parent: mainDraft.url,
      drafts: [],
      clones: {},
    });
    mainDraft.change((d) => d.drafts.push(draft.url));

    let checkedOutUrl: AutomergeUrl | undefined;
    env.disposers.push(
      subscribe<AutomergeUrl>(
        overlayEl,
        { type: "draft:checked-out" },
        (url) => (checkedOutUrl = url)
      )
    );
    await vi.waitFor(() => expect(checkedOutUrl).toBeDefined());
    const checkedOut = await repo.find<CheckedOutDraft>(checkedOutUrl!);
    checkedOut.change((d) => (d.checkedOut = draft.url));

    const clone = await waitForClone(env, descriptor);
    expect(clone.url).not.toBe(host.url);
    expect(clone.doc().array).toEqual([1, 2, 3]);
    const cloneHeads = clone.heads();

    host.change((d) => d.array.push(4));
    await new Promise((r) => setTimeout(r, 20));

    expect(host.doc().array).toEqual([1, 2, 3, 4]);
    expect(clone.heads()).toEqual(cloneHeads);
    expect(clone.doc().array).toEqual([1, 2, 3]);
  });

  it("with the sidebar rendered, a change to main does not reach the clone", async () => {
    const { host, sidebarEl } = env;
    const descriptor = watchDescriptor(env, host.url);
    env.disposers.push(renderDraftsSidebar(null as never, sidebarEl));

    // Fork a draft through the UI: Main card menu -> Fork.
    const menu = await vi.waitFor(() => {
      const el = sidebarEl.querySelector<HTMLButtonElement>(
        'button[title="Draft actions"]'
      );
      expect(el).not.toBeNull();
      return el!;
    });
    menu.click();
    const fork = await vi.waitFor(() => {
      const el = sidebarEl.querySelector<HTMLButtonElement>(
        'button[title="Fork a new draft from the latest version"]'
      );
      expect(el).not.toBeNull();
      expect(el!.disabled).toBe(false);
      return el!;
    });
    fork.click();

    const clone = await waitForClone(env, descriptor);
    expect(clone.url).not.toBe(host.url);
    expect(clone.doc().array).toEqual([1, 2, 3]);
    const cloneHeads = clone.heads();

    host.change((d) => d.array.push(4));
    await new Promise((r) => setTimeout(r, 20));

    expect(host.doc().array).toEqual([1, 2, 3, 4]);
    expect(clone.heads()).toEqual(cloneHeads);
    expect(clone.doc().array).toEqual([1, 2, 3]);
  });
});
