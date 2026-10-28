import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import type { AccountDoc } from "../types";

/**
 * Where the account bar's Packages button goes: the module-settings doc, for
 * an account from before `/packages`. Once `/packages` is bound, packages are a
 * folder in the sidebar and the button goes away.
 */
export function packagesLinkUrl(
  doc: Pick<AccountDoc, "moduleSettingsUrl" | "namespace"> | undefined
): AutomergeUrl | undefined {
  if (doc?.namespace?.["/packages"]?.length) return undefined;
  return doc?.moduleSettingsUrl;
}
