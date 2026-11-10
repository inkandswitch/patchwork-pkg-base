// the bits of account/ the "you" section needs, copied rather than linked
// (see CLAUDE.md): the contact doc's shape, the presence palette, and the
// account token you paste in to use this account somewhere else
import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo/slim";

export type ContactDoc =
  | { type: "anonymous"; color?: string }
  | { type: "registered"; name: string; avatarUrl?: AutomergeUrl; color?: string };

export type AccountDoc = {
  contactUrl?: AutomergeUrl;
  rootFolderUrl?: AutomergeUrl;
  moduleSettingsUrl?: AutomergeUrl;
  frameToolId?: string;
  tools?: Record<string, AutomergeUrl>;
  toolStorage?: Record<string, AutomergeUrl>;
};

// account/src/user-colors.ts
export const USER_COLOR_PALETTE = [
  { name: "Sky Blue", value: "hsl(200, 70%, 50%)" },
  { name: "Coral", value: "hsl(10, 75%, 58%)" },
  { name: "Emerald", value: "hsl(145, 70%, 45%)" },
  { name: "Violet", value: "hsl(270, 70%, 55%)" },
  { name: "Amber", value: "hsl(38, 85%, 50%)" },
  { name: "Rose", value: "hsl(350, 70%, 55%)" },
  { name: "Teal", value: "hsl(178, 70%, 45%)" },
  { name: "Indigo", value: "hsl(235, 70%, 58%)" },
  { name: "Lime", value: "hsl(85, 70%, 45%)" },
  { name: "Fuchsia", value: "hsl(310, 70%, 55%)" },
  { name: "Orange", value: "hsl(25, 80%, 52%)" },
  { name: "Cyan", value: "hsl(188, 75%, 48%)" },
] as const;

export function colorFromString(str: string): string {
  const hash = Math.abs(str.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0));
  return USER_COLOR_PALETTE[hash % USER_COLOR_PALETTE.length].value;
}

// the key the bootloader reads the account from (account picker's, kept)
export const ACCOUNT_URL_STORAGE_KEY = "tinyPatchworkAccountUrl";

// account/src/picker/tokens.ts
export function accountToken(url: AutomergeUrl, name: string): string {
  const { documentId } = parseAutomergeUrl(url);
  return `account:${encodeURIComponent(name)}/${documentId}`;
}

export function accountUrlFromToken(token: string): AutomergeUrl | undefined {
  const match = token.trim().match(/^account:([^/]+)\/(.+)$/);
  if (!match?.[2]) return undefined;
  const url = `automerge:${match[2]}`;
  return isValidAutomergeUrl(url) ? (url as AutomergeUrl) : undefined;
}

// a picture, made square (the middle of it) and small (lattice's)
const PICTURE = 256;
export async function squarePicture(file: File): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(PICTURE, side);
  const canvas = new OffscreenCanvas(size, size);
  canvas
    .getContext("2d")!
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
  return new Uint8Array(await blob.arrayBuffer());
}
