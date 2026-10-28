// Docs that aren't folders but have children: a directory doc's files (a
// pushwork package), a branches doc's branches. Which children they have is the
// host's patchwork-filesystem path providers' call (an importmap external), the
// same ones a path walks, so a child opens at a path the router can resolve. A
// host without providers shows these docs as plain rows, as before.
import * as filesystem from "@inkandswitch/patchwork-filesystem";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";

type Child = { name: string; link?: AutomergeUrl; value?: unknown; union?: AutomergeUrl[] };
type Providers = {
  providerFor(doc: unknown): { list(node: unknown): Child[] } | undefined;
};

const hostProviders = filesystem as unknown as Partial<Providers>;

// Types whose rows expand through a provider. Folders have their own row
// (folder.tsx), which can also be edited.
const EXPANDABLE = new Set(["directory", "branches"]);

/** Whether a link of `type` can be opened up to show its children. */
export function canExpand(
  type: string,
  providers: Partial<Providers> = hostProviders
): boolean {
  return EXPANDABLE.has(type) && typeof providers.providerFor === "function";
}

/** The documents `doc` links to, by name; values inside it aren't documents. */
export function containerChildren(
  doc: unknown,
  providers: Partial<Providers> = hostProviders
): Array<{ name: string; url: AutomergeUrl }> {
  const provider = providers.providerFor?.(doc);
  return (provider?.list(doc) ?? []).flatMap((child) =>
    child.link ? [{ name: child.name, url: child.link }] : []
  );
}
