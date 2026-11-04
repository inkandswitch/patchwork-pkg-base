import {
  isImmutableString,
  isValidAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo/slim";

import type { HasDrafts } from "./draft-types.js";
import { canonicalUrl } from "./clone-policy.js";

// The two container shapes the sidebar lists: a folder doc
// (`{ docs: [{ url, type, name }] }`) and a pushwork directory doc, whose
// non-reserved keys are slash-separated paths to leaf docs.
export type ContainerChild = {
  url: AutomergeUrl;
  isContainer: boolean;
};

const CONTAINER_TYPES: ReadonlySet<string> = new Set(["folder", "directory"]);
const DIRECTORY_RESERVED: ReadonlySet<string> = new Set([
  "@patchwork",
  "lastSyncAt",
]);

export function isContainerType(type: string | undefined): boolean {
  return type !== undefined && CONTAINER_TYPES.has(type);
}

export function isWorkspaceFolder(doc: HasDrafts | undefined): boolean {
  return (
    asString(doc?.["@patchwork"]?.type) === "folder" &&
    doc?.["@patchwork"]?.workspace === true
  );
}

// Children in entry order, which is what makes "first path wins" stable
// across peers.
export function containerChildren(doc: unknown): ContainerChild[] {
  if (!doc || typeof doc !== "object") return [];
  const record = doc as Record<string, unknown>;
  const type = asString(
    (record["@patchwork"] as { type?: unknown } | undefined)?.type
  );
  if (type === "directory") return directoryChildren(record);
  if (!Array.isArray(record.docs)) return [];
  const children: ContainerChild[] = [];
  for (const link of record.docs as unknown[]) {
    const entry = link as { url?: unknown; type?: unknown } | null;
    const url = asUrl(entry?.url);
    if (!url) continue;
    children.push({
      url: canonicalUrl(url),
      isContainer: isContainerType(asString(entry?.type)),
    });
  }
  return children;
}

function directoryChildren(
  record: Record<string, unknown>
): ContainerChild[] {
  const children: ContainerChild[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (DIRECTORY_RESERVED.has(key)) continue;
    const url = asUrl(value);
    if (url) children.push({ url: canonicalUrl(url), isContainer: false });
  }
  return children;
}

// Pushwork writes links as ImmutableStrings; read them like plain strings.
function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (isImmutableString(value)) return String(value);
  return undefined;
}

function asUrl(value: unknown): AutomergeUrl | undefined {
  const s = asString(value);
  return s !== undefined && isValidAutomergeUrl(s) ? s : undefined;
}
