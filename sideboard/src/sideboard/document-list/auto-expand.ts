import type {
  AutomergeUrl,
  DocHandle,
  Repo,
} from "@automerge/automerge-repo/slim";
import type { DocLink, FolderDoc } from "@inkandswitch/patchwork-filesystem";

// Rows currently mounted in each panel, refcounted (a doc can appear in more
// than one folder). Children only mount when their folder is expanded, so a
// mounted row means every folder above it is already open — a selection made
// by clicking a row needs no walk at all.
const mountedRows = new WeakMap<object, Map<AutomergeUrl, number>>();

/** Record that `panel` is rendering a row for `url`. Returns the unmount. */
export function markMounted(panel: object, url: AutomergeUrl): () => void {
  let rows = mountedRows.get(panel);
  if (!rows) mountedRows.set(panel, (rows = new Map()));
  rows.set(url, (rows.get(url) ?? 0) + 1);
  return () => {
    const n = rows.get(url)! - 1;
    if (n) rows.set(url, n);
    else rows.delete(url);
  };
}

export function isMounted(panel: object, url: AutomergeUrl): boolean {
  return !!mountedRows.get(panel)?.has(url);
}

// Reverse index of every folder we've loaded: child url → the folders that
// link to it. Kept current by listening to each folder handle's changes, so it
// can answer "which folders lead to this doc?" by walking up, without any finds.
const parents = new Map<AutomergeUrl, Set<AutomergeUrl>>();
const children = new Map<AutomergeUrl, Set<AutomergeUrl>>();
const watched = new WeakSet<DocHandle<FolderDoc>>();

function indexFolder(folderUrl: AutomergeUrl, docs: DocLink[] | undefined) {
  const next = new Set(docs?.map((link) => link.url));
  const prev = children.get(folderUrl);
  if (prev) {
    for (const child of prev) {
      if (next.has(child)) continue;
      const set = parents.get(child);
      set?.delete(folderUrl);
      if (!set?.size) parents.delete(child);
    }
  }
  for (const child of next) {
    let set = parents.get(child);
    if (!set) parents.set(child, (set = new Set()));
    set.add(folderUrl);
  }
  children.set(folderUrl, next);
}

/** Add a folder to the parent index and keep it current. Idempotent. */
export function watchFolder(handle: DocHandle<FolderDoc>) {
  if (watched.has(handle)) return;
  watched.add(handle);
  indexFolder(handle.url, handle.doc()?.docs);
  handle.on("change", () => indexFolder(handle.url, handle.doc()?.docs));
}

/**
 * Answer the same question as collectExpandedFolders from the parent index:
 * walk up from each selected doc and collect every folder on a path that
 * reaches `rootUrl` (including the root itself). Returns null if any selected
 * doc can't be traced to the root with what's indexed so far — the caller
 * then falls back to the full walk, which indexes everything it loads.
 */
export function expandedFoldersFromIndex(
  rootUrl: AutomergeUrl,
  selected: Iterable<AutomergeUrl>
): Set<AutomergeUrl> | null {
  const result = new Set<AutomergeUrl>();
  // url → whether it reaches the root. Seeded false on entry so a cycle
  // terminates instead of recursing forever.
  const reaches = new Map<AutomergeUrl, boolean>([[rootUrl, true]]);

  function up(url: AutomergeUrl): boolean {
    const known = reaches.get(url);
    if (known !== undefined) return known;
    reaches.set(url, false);
    let found = false;
    for (const parent of parents.get(url) ?? []) {
      if (up(parent)) {
        result.add(parent);
        found = true;
      }
    }
    reaches.set(url, found);
    return found;
  }

  for (const url of selected) {
    if (url !== rootUrl && !up(url)) return null;
  }
  return result;
}

/**
 * Walk the folder tree from `folderUrl` and collect the URLs of every folder
 * that has a selected document somewhere in its subtree — i.e. the set of
 * folders that must be expanded for the selection to be visible.
 *
 * This reads folder docs directly (one cached `repo.find` each) rather than
 * relying on mounted components, so it finds the full ancestor chain even for a
 * deeply nested selection whose folders aren't mounted yet. Leaf docs are never
 * loaded — selection is matched against the urls already present in each
 * folder's docrefs.
 *
 * Returns whether `folderUrl`'s subtree contains a selection; ancestors are
 * accumulated into `result`. `visited` is branched per path so a folder that
 * legitimately appears under two parents is handled, while true cycles stop.
 */
export async function collectExpandedFolders(
  repo: Repo,
  folderUrl: AutomergeUrl,
  selected: Set<AutomergeUrl>,
  result: Set<AutomergeUrl>,
  visited: Set<AutomergeUrl>
): Promise<boolean> {
  if (visited.has(folderUrl)) return false;
  const nextVisited = new Set(visited);
  nextVisited.add(folderUrl);

  let doc: FolderDoc | undefined;
  try {
    const handle = await repo.find<FolderDoc>(folderUrl);
    watchFolder(handle);
    doc = handle.doc();
  } catch {
    return false;
  }
  if (!doc?.docs) return false;

  let contains = doc.docs.some((child) => selected.has(child.url));
  const subfolders = await Promise.all(
    doc.docs
      .filter((child) => child.type === "folder")
      .map((child) =>
        collectExpandedFolders(repo, child.url, selected, result, nextVisited)
      )
  );
  if (subfolders.some(Boolean)) contains = true;

  if (contains) result.add(folderUrl);
  return contains;
}
