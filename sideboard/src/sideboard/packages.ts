import {
  isValidAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo/slim";
import type { SideboardAccountDoc } from "../types.ts";

/**
 * The folders bound at `/packages`, in order. Package management is editing
 * them: a link in one is an installed package. Empty for an account from
 * before `/packages`, which still has the Packages tool.
 */
export function packagesFolders(
  doc: Pick<SideboardAccountDoc, "namespace"> | undefined
): AutomergeUrl[] {
  return (doc?.namespace?.["/packages"] ?? [])
    .map((binding) => binding?.url)
    .filter((url): url is AutomergeUrl => isValidAutomergeUrl(url));
}
