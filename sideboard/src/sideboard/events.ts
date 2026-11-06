import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
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
 */
export function openInside(
  open: Open,
  folderUrl: AutomergeUrl,
  folder: () => unknown
): Open {
  return (detail) =>
    open({
      ...detail,
      path: [folderUrl, ...(detail.path ?? [])],
      workspace: isWorkspace(folder()) ? folderUrl : detail.workspace,
    });
}

export function isWorkspace(doc: unknown): boolean {
  const meta = (doc as { "@patchwork"?: { type?: unknown; workspace?: unknown } })?.[
    "@patchwork"
  ];
  return String(meta?.type) === "folder" && meta?.workspace === true;
}
