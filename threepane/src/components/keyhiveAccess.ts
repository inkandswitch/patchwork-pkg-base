import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import * as elements from "@inkandswitch/patchwork-elements";
import { isKeyhiveDoc } from "@inkandswitch/patchwork-plugins";

// patchwork-view's own access check, from a patchwork that has one to share:
// it counts a doc made public, which this identity's keyhive can't see
const gateCheck = (
  elements as {
    hasActiveAccess?: (hive: never, url: AutomergeUrl) => Promise<boolean>;
  }
).hasActiveAccess;

/** The parts of the page's keyhive this reads. patchwork's setup() puts it on window.hive. */
type Hive = {
  active: {
    individual: { id: unknown };
    contactCard: { toBytes(): Uint8Array };
  };
  accessForDoc(id: unknown, url: AutomergeUrl): Promise<unknown>;
  bestAccessForDoc?(id: unknown, url: AutomergeUrl): Promise<unknown>;
  networkAdapter?: {
    on(event: "ingest-remote", listener: () => void): unknown;
    off(event: "ingest-remote", listener: () => void): unknown;
  };
};

export const pageHive = (): Hive | undefined =>
  (globalThis as { hive?: Hive }).hive;

/**
 * Whether this identity may open `url`, decided the way patchwork-view's gate
 * decides it, so a "not shared with you" card shows exactly when the view
 * won't open. An older patchwork's gate only counts the identity's own
 * access. A doc keyhive doesn't govern is "shared" (nothing holds it back);
 * "unknown" is when the check itself failed, which is not the same as yes.
 */
export async function canOpen(
  hive: Hive,
  url: AutomergeUrl
): Promise<"shared" | "not-shared" | "unknown"> {
  if (!isKeyhiveDoc(url)) return "shared";
  try {
    if (gateCheck) return (await gateCheck(hive as never, url)) ? "shared" : "not-shared";
    const id = hive.active.individual.id;
    const access = hive.bestAccessForDoc
      ? await hive.bestAccessForDoc(id, url)
      : await hive.accessForDoc(id, url);
    return access ? "shared" : "not-shared";
  } catch {
    return "unknown";
  }
}

/** Calls `listener` whenever keyhive takes in ops from elsewhere, a grant among them. */
export function onKeyhiveOps(hive: Hive, listener: () => void): () => void {
  hive.networkAdapter?.on("ingest-remote", listener);
  return () => hive.networkAdapter?.off("ingest-remote", listener);
}

/** This identity's contact card, as the phonebook copies it: base64 of its bytes. */
export function cardText(hive: Hive): string | undefined {
  try {
    let binary = "";
    for (const byte of hive.active.contactCard.toBytes()) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  } catch {
    return undefined;
  }
}
