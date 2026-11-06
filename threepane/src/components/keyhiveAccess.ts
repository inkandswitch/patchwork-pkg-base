import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { isKeyhiveDoc } from "@inkandswitch/patchwork-plugins";

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
 * decides it (patchwork-elements' activeAccessForDoc), so a "not shared with
 * you" card shows exactly when the view won't open. Undefined when keyhive
 * doesn't govern the doc, or can't say.
 */
export async function canOpen(
  hive: Hive,
  url: AutomergeUrl
): Promise<boolean | undefined> {
  if (!isKeyhiveDoc(url)) return undefined;
  try {
    const id = hive.active.individual.id;
    const access = hive.bestAccessForDoc
      ? await hive.bestAccessForDoc(id, url)
      : await hive.accessForDoc(id, url);
    return !!access;
  } catch {
    return undefined;
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
