import { isImmutableString } from "@automerge/automerge-repo/slim";

import type { HasDrafts } from "./draft-types.js";

// Folders only become draft roots once they're made workspaces.
const CONTAINER_TYPES: ReadonlySet<string> = new Set(["folder", "directory"]);

export function isContainerType(type: string | undefined): boolean {
  return type !== undefined && CONTAINER_TYPES.has(type);
}

export function isWorkspaceFolder(doc: HasDrafts | undefined): boolean {
  return (
    asString(doc?.["@patchwork"]?.type) === "folder" &&
    doc?.["@patchwork"]?.workspace === true
  );
}

// Pushwork writes links as ImmutableStrings; read them like plain strings.
function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (isImmutableString(value)) return String(value);
  return undefined;
}
