import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";
import {
  accept,
  subscribe,
  type SubscribeEvent,
} from "@inkandswitch/patchwork-providers";

import type { DraftDoc, HasDrafts } from "../draft-types.js";
import { canonicalUrl } from "../clone-policy.js";
import { draftReadUrl, entryReadUrl } from "../draft-clones.js";
import { baseRepo } from "../draft-repo.js";
import { childrenOf, watchDocTree, type DocTree } from "../doc-tree.js";
import { isWorkspaceFolder } from "../folder-links.js";
import { readHashParam, writeHashParams } from "../hash-params.js";

const WORKSPACE_ROOT_SELECTOR = "workspace:root";
const CHECKOUTS_SELECTOR = "checkouts";
const SELECTED_VIEW_SELECTOR = "patchwork:selected-view";
const OPEN_DOCUMENT_EVENT = "patchwork:open-document";

// The workspace the selected doc belongs to.
//   - `docUrl`: the selected doc, exactly as `patchwork:selected-view` gave
//     it, so the frame can tell which selection an answer is for.
//   - `rootUrl`: the workspace folder the doc was opened in, or the doc
//     itself when it isn't in one.
export type WorkspaceRoot = {
  docUrl: string;
  rootUrl: AutomergeUrl;
};

type SelectedView = { url?: string; workspace?: string | null };

// `workspace` and `path` are newer than the published elements types.
type OpenDetail = {
  url: AutomergeUrl;
  workspace?: AutomergeUrl;
  path?: AutomergeUrl[];
};

// Decides which workspace the selected doc is shown in, and answers
// `workspace:root` with it. The frame mounts a draft provider per root from
// the answer. The workspace comes from whoever opened the doc:
//   - The sidebar says which folders it went through (`path`) and which
//     workspace that puts the doc in. Such an open is held here until the
//     path checks out, and dropped if it doesn't.
//   - `workspace=` in the URL is checked by walking that workspace.
//   - An open that doesn't say (a link inside a document) stays in the
//     current workspace if the doc is in it, and is otherwise its own root.
// Nothing is answered until that's settled, so a doc never shows in the wrong
// root first. The answer is stamped back into the URL as `workspace=`, and
// unless the URL already names a draft, the one the frame's checkout provider
// has for the root goes into `draft=` (core's router drops it whenever
// another doc opens).
//
// Read-only: it never creates or edits a document. Workspace trees, and the
// folders an open went through, are read through the draft each workspace
// has checked out, so docs that only exist on that draft count too.
export const WorkspaceProvider = (element: HTMLElement, inherited: Repo) => {
  const repo = baseRepo(inherited);

  let disposed = false;
  let latest: WorkspaceRoot | null = null;
  let current: Workspace | null = null;
  // What each root has checked out, from the checkout provider.
  let checkouts: Record<AutomergeUrl, AutomergeUrl | null> = {};
  let resolving = 0;
  // `${workspace} ${doc}` for every open let through, so its selection
  // doesn't walk the workspace again.
  const admitted = new Set<string>();
  // Docs the sidebar opened outside any workspace.
  const unclaimed = new Set<AutomergeUrl>();
  const passing = new WeakSet<Event>();
  const subscribers = new Set<(root: WorkspaceRoot) => void>();

  element.addEventListener(OPEN_DOCUMENT_EVENT, onOpen);
  element.addEventListener("patchwork:subscribe", onSubscribe);
  const unsubscribeSelectedView = subscribe<SelectedView | null>(
    element,
    { type: SELECTED_VIEW_SELECTOR },
    (view) => void select(view)
  );
  const unsubscribeCheckouts = subscribe<Record<AutomergeUrl, AutomergeUrl | null>>(
    element,
    { type: CHECKOUTS_SELECTOR },
    (next) => {
      checkouts = next;
      if (current) current.readThrough(checkouts[current.root] ?? null);
    }
  );

  return () => {
    disposed = true;
    element.removeEventListener(OPEN_DOCUMENT_EVENT, onOpen);
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    unsubscribeSelectedView();
    unsubscribeCheckouts();
    current?.dispose();
    subscribers.clear();
  };

  function onOpen(event: Event): void {
    if (passing.has(event)) return;
    const detail = (event as CustomEvent<OpenDetail>).detail;
    if (!detail || !isValidAutomergeUrl(detail.url)) return;
    if (!detail.path && !detail.workspace) return;
    event.stopPropagation();
    void placed(detail).then((placement) => {
      if (disposed) return;
      if (!placement) {
        console.warn(
          `[drafts] not opening ${detail.url}: it isn't in ` +
            (detail.path ? "the folders it was opened from" : `workspace ${detail.workspace}`)
        );
        return;
      }
      const doc = canonicalUrl(detail.url);
      if (placement.workspace) admitted.add(pair(placement.workspace, doc));
      else unclaimed.add(doc);
      const next = new CustomEvent(OPEN_DOCUMENT_EVENT, {
        detail: { ...detail, workspace: placement.workspace ?? undefined },
        bubbles: true,
        composed: true,
      });
      passing.add(next);
      element.dispatchEvent(next);
    });
  }

  function onSubscribe(event: SubscribeEvent): void {
    if (event.detail.selector.type !== WORKSPACE_ROOT_SELECTOR) return;
    accept<WorkspaceRoot>(event, (respond) => {
      subscribers.add(respond);
      if (latest) respond(latest);
      return () => {
        subscribers.delete(respond);
      };
    });
  }

  async function select(view: SelectedView | null): Promise<void> {
    const seq = ++resolving;
    const docUrl = view?.url;
    if (typeof docUrl !== "string" || !isValidAutomergeUrl(docUrl)) return;
    const claimed =
      typeof view?.workspace === "string" && isValidAutomergeUrl(view.workspace)
        ? view.workspace
        : null;
    const next = await workspaceOf(canonicalUrl(docUrl), claimed);
    if (disposed || seq !== resolving) {
      if (next !== current) next?.dispose();
      return;
    }
    answer(docUrl, next?.root ?? canonicalUrl(docUrl), next);
  }

  // The workspace to show `doc` in, or null for its own root.
  async function workspaceOf(
    doc: AutomergeUrl,
    claimed: AutomergeUrl | null
  ): Promise<Workspace | null> {
    if (claimed) {
      const root = canonicalUrl(claimed);
      const workspace = current?.root === root ? current : openWorkspace(root);
      if (admitted.has(pair(root, doc)) || (await workspace.has(doc))) {
        return workspace;
      }
      if (workspace !== current) workspace.dispose();
    }
    const outside = unclaimed.delete(doc);
    if (!outside && current && (await current.has(doc))) return current;
    if (await isWorkspace(doc)) {
      return current?.root === doc ? current : openWorkspace(doc);
    }
    return null;
  }

  function answer(
    docUrl: AutomergeUrl,
    rootUrl: AutomergeUrl,
    workspace: Workspace | null
  ): void {
    if (workspace !== current) {
      current?.dispose();
      current = workspace;
    }
    const remembered = readHashParam("draft") ? null : checkouts[rootUrl];
    writeHashParams({
      workspace: workspace?.root ?? null,
      ...(remembered ? { draft: remembered } : {}),
    });
    if (latest?.docUrl === docUrl && latest.rootUrl === rootUrl) return;
    latest = { docUrl, rootUrl };
    for (const respond of subscribers) respond(latest);
  }

  // Where an open belongs, or null if it doesn't add up. With the folders it
  // went through, each has to link the next, and the topmost workspace among
  // them (or the doc itself) is the one it's in: read here rather than taken
  // from the claim, since the sidebar's copy of a folder can lag behind it
  // becoming a workspace. Everything beneath that workspace is read through
  // the draft it has checked out, as the sidebar shows it, and a folder in
  // the path may be pinned to the version that still lists a removed doc.
  // Without a path, the claimed workspace has to have the doc in its tree.
  async function placed(
    detail: OpenDetail
  ): Promise<{ workspace: AutomergeUrl | null } | null> {
    const doc = canonicalUrl(detail.url);
    try {
      if (!detail.path) {
        const root = canonicalUrl(detail.workspace!);
        const workspace = current?.root === root ? current : openWorkspace(root);
        const ok = await workspace.has(doc);
        if (workspace !== current) workspace.dispose();
        return ok ? { workspace: root } : null;
      }
      const chain = [...detail.path, doc];
      const docs: HasDrafts[] = [];
      let workspace: AutomergeUrl | null = null;
      let clones: DraftDoc["clones"] | undefined;
      for (const url of chain) {
        if (!workspace && (await isWorkspace(canonicalUrl(url)))) {
          workspace = canonicalUrl(url);
          const draft = checkouts[workspace];
          if (draft) clones = (await repo.find<DraftDoc>(draft)).doc()?.clones;
        }
        const read = clones ? draftReadUrl(clones, url) : url;
        docs.push((await repo.find<HasDrafts>(read)).doc());
      }
      for (let i = 0; i < chain.length - 1; i++) {
        const next = canonicalUrl(chain[i + 1]);
        const children = await childrenOf(docs[i]);
        if (!children.some((child) => child.url === next)) return null;
      }
      return { workspace };
    } catch {
      return null;
    }
  }

  async function isWorkspace(url: AutomergeUrl): Promise<boolean> {
    try {
      return isWorkspaceFolder((await repo.find<HasDrafts>(url)).doc());
    } catch {
      return false;
    }
  }

  function openWorkspace(root: AutomergeUrl): Workspace {
    const draft = root in checkouts ? checkouts[root] : readHashParam("draft");
    return watchWorkspace(repo, root, draft);
  }
};

type Workspace = {
  root: AutomergeUrl;
  // Whether the workspace folder is one and `url` is in its tree, once the
  // first walk is done.
  has: (url: AutomergeUrl) => Promise<boolean>;
  readThrough: (draftUrl: AutomergeUrl | null) => void;
  dispose: () => void;
};

// A workspace folder's tree, read through `draftUrl`'s clones while it's set.
// The walk starts once that draft has loaded, so the first answer already
// reflects it.
function watchWorkspace(
  repo: Repo,
  root: AutomergeUrl,
  draftUrl: AutomergeUrl | null
): Workspace {
  let disposed = false;
  let draft: DocHandle<DraftDoc> | null = null;
  let wanted = draftUrl;
  let tree: DocTree | null = null;
  const onDraftChange = () => tree?.refresh();

  const walked = (async () => {
    await follow(draftUrl);
    if (disposed) return false;
    const flagged = await repo
      .find<HasDrafts>(root)
      .then((handle) => isWorkspaceFolder(handle.doc()), () => false);
    if (!flagged || disposed) return false;
    tree = watchDocTree(repo, root, {
      readUrl: (url) => {
        const entry = draft?.doc()?.clones?.[url];
        return entry ? entryReadUrl(url, entry) : url;
      },
    });
    await tree.settled();
    return true;
  })();

  return {
    root,
    async has(url) {
      return (await walked) && !!tree?.has(url);
    },
    readThrough(url) {
      wanted = url;
      void follow(url).then(() => tree?.refresh());
    },
    dispose() {
      disposed = true;
      draft?.off("change", onDraftChange);
      tree?.dispose();
    },
  };

  async function follow(url: AutomergeUrl | null): Promise<void> {
    if (url === (draft?.url ?? null)) return;
    const next = url
      ? await repo.find<DraftDoc>(url).catch(() => null)
      : null;
    if (disposed || url !== wanted) return;
    draft?.off("change", onDraftChange);
    draft = next;
    draft?.on("change", onDraftChange);
  }
}

function pair(workspace: AutomergeUrl, doc: AutomergeUrl): string {
  return `${canonicalUrl(workspace)} ${canonicalUrl(doc)}`;
}
