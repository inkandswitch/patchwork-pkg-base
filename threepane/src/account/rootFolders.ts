import { isValidAutomergeUrl, type AutomergeUrl } from "@automerge/automerge-repo/slim";
import { DOCUMENT_LIST_TOOL } from "../datatypes";
import type { AccountDoc, ToolSlot } from "../types";

/**
 * The folders bound at `/`, in order: the account's root, as paths see it.
 * Falls back to `rootFolderUrl` when the namespace binds nothing valid there,
 * as patchwork-filesystem's `accountBindings` does.
 */
export function rootFolders(
  doc: Pick<AccountDoc, "rootFolderUrl" | "namespace"> | undefined
): AutomergeUrl[] {
  const bound = (doc?.namespace?.["/"] ?? [])
    .map((binding) => binding?.url)
    .filter((url): url is AutomergeUrl => isValidAutomergeUrl(url));
  if (bound.length) return bound;
  return isValidAutomergeUrl(doc?.rootFolderUrl) ? [doc!.rootFolderUrl!] : [];
}

/**
 * The sidebar's widgets as shown: the root folder's document list, which the
 * config doc was seeded with, stands for `/` and shows one list per folder
 * bound there, read live, so rebinding `/` moves the sidebar with it. `slots`
 * keeps one slot per folder across calls, so a list already up isn't remounted.
 */
export function sidebarWidgetsFor(
  widgets: ToolSlot[],
  doc: Pick<AccountDoc, "rootFolderUrl" | "namespace"> | undefined,
  slots: Map<AutomergeUrl, ToolSlot> = new Map()
): ToolSlot[] {
  const root = doc?.rootFolderUrl;
  if (!root) return widgets;
  const slotFor = (url: AutomergeUrl): ToolSlot => {
    let slot = slots.get(url);
    if (!slot) slots.set(url, (slot = [DOCUMENT_LIST_TOOL, url]));
    return slot;
  };
  return widgets.flatMap((widget): ToolSlot[] =>
    Array.isArray(widget) && widget[0] === DOCUMENT_LIST_TOOL && widget[1] === root
      ? rootFolders(doc).map(slotFor)
      : [widget]
  );
}
