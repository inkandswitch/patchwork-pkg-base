import type { AutomergeUrl, UrlHeads } from "@automerge/automerge-repo";

export type CloneEntry = {
  cloneUrl: AutomergeUrl;
  clonedAt: UrlHeads;
};

export type WorkspaceDoc = {
  "@patchwork": { type: "workspace" };
  clones: Record<AutomergeUrl, CloneEntry>;
  drafts: AutomergeUrl[];
  parent: AutomergeUrl | null;
};

// Ephemeral state owned by the workspace provider; consumers mutate
// `selectedDraft` to switch drafts.
export type WorkspaceState = {
  drafts: AutomergeUrl[];
  selectedDraft: AutomergeUrl;
};

export function isWorkspaceDoc(value: unknown): value is WorkspaceDoc {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const marker = v["@patchwork"] as { type?: string } | undefined;
  return (
    marker?.type === "workspace" && !!v.clones && typeof v.clones === "object"
  );
}
