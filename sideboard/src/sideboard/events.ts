import {
  parseAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo/slim";
import type { OpenDocumentEventDetail } from "@inkandswitch/patchwork-elements";

// `workspace` and `path` are newer than the published elements types.
export type OpenDetail = OpenDocumentEventDetail & {
  workspace?: AutomergeUrl;
  path?: AutomergeUrl[];
};

export type Open = (detail: OpenDetail) => void;

export function createOpenEvent(detail: OpenDetail) {
  const openEvent = new CustomEvent("patchwork:open-document", {
    detail,
    bubbles: true,
    composed: true,
  });
  return openEvent;
}

/**
 * The `open` for the documents listed inside `folderUrl`: it adds the folder
 * to the path, and claims the folder as the workspace if it is one. Folders
 * wrap their parent's `open`, so the topmost workspace claims last and wins.
 * A path that already starts with this folder (pinned to a version, for a
 * removed doc) keeps it as it is.
 */
export function openInside(
  open: Open,
  folderUrl: AutomergeUrl,
  folder: () => unknown
): Open {
  return (detail) => {
    const path = detail.path ?? [];
    return open({
      ...detail,
      path: sameDocument(path[0], folderUrl) ? path : [folderUrl, ...path],
      workspace: isWorkspace(folder()) ? folderUrl : detail.workspace,
    });
  };
}

function sameDocument(a: AutomergeUrl | undefined, b: AutomergeUrl): boolean {
  if (!a) return false;
  try {
    return parseAutomergeUrl(a).documentId === parseAutomergeUrl(b).documentId;
  } catch {
    return false;
  }
}

export function isWorkspace(doc: unknown): boolean {
  const meta = (doc as { "@patchwork"?: { type?: unknown; workspace?: unknown } })?.[
    "@patchwork"
  ];
  return String(meta?.type) === "folder" && meta?.workspace === true;
}
