// the bits of account/ the "you" section needs, copied rather than linked
// (see CLAUDE.md): the contact doc's shape, the presence palette, and the
// account key you copy to use this account somewhere else
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

// and back: the account a key (or a bare automerge: url) is for. only the
// document id counts; the name in the key is there for people
export function accountUrlFromToken(token: string): AutomergeUrl | undefined {
  const key = token.trim();
  if (isValidAutomergeUrl(key)) return key;
  const documentId = key.match(/^account:[^/]*\/(.+)$/)?.[1];
  const url = `automerge:${documentId}`;
  return documentId && isValidAutomergeUrl(url) ? url : undefined;
}

// a picture, made square and small: the square you cropped it to, or else
// the middle of it
const PICTURE = 256;
export type Crop = { x: number; y: number; size: number };
export async function squarePicture(file: File, crop?: Crop): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const from = crop ?? { x: (bitmap.width - side) / 2, y: (bitmap.height - side) / 2, size: side };
  const size = Math.round(Math.min(PICTURE, from.size));
  const canvas = new OffscreenCanvas(size, size);
  canvas.getContext("2d")!.drawImage(bitmap, from.x, from.y, from.size, from.size, 0, 0, size, size);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
  return new Uint8Array(await blob.arrayBuffer());
}

// any css colour as #rrggbb, for <input type="color">
export function hexColor(color: string): string {
  const context = new OffscreenCanvas(1, 1).getContext("2d")!;
  context.fillStyle = "#000000";
  context.fillStyle = color;
  return String(context.fillStyle);
}
