// The live path of a row in the account's root folder: `<acctHash>/Projects/foo`,
// the names walked from the root, each encoded. Opening a row with it sets
// `&path=` and hands the tool `<patchwork-view path>`. Copied from
// patchwork-filesystem's paths.ts (tools don't import across packages).
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import type { OpenDocumentEventDetail } from "@inkandswitch/patchwork-elements";

/**
 * An open-document request that may say where it was opened from. `path` is on
 * `OpenDocumentEventDetail` in patchwork-elements releases with paths; spelled
 * out here so this builds against older ones too.
 */
export type OpenDetail = OpenDocumentEventDetail & { path?: string };

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const byte of bytes) n = n * 256n + BigInt(byte);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = "1" + out;
  }
  return out;
}

/** The first 12 bytes of SHA-256 over a document id, in base58. */
export async function idhash(documentId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(documentId)
  );
  return base58(new Uint8Array(digest).slice(0, 12));
}

export type LivePathOf = (names: string[]) => string;

/**
 * Live paths for rows under `folderUrl`, if it's `account`'s root folder:
 * paths start at the account, so only its tree has them. Undefined otherwise.
 */
export async function livePathsFor(
  account:
    | { documentId: string; doc(): { rootFolderUrl?: AutomergeUrl } | undefined }
    | undefined,
  folderUrl: AutomergeUrl
): Promise<LivePathOf | undefined> {
  if (!account || account.doc()?.rootFolderUrl !== folderUrl) return undefined;
  const acctHash = await idhash(account.documentId);
  return (names) => [acctHash, ...names.map(encodeURIComponent)].join("/");
}
