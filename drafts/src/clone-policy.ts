import {
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo/slim";

// HACK: datatypes the draft machinery must never treat as draft content.
//
// The overlay forks *every* document resolved beneath it so edits stay scoped
// to the draft. But some docs pulled through the overlay are app-global rather
// than part of the document being drafted: the account doc (read by the context
// sidebar, which renders inside the overlay) and contact docs (resolved per
// comment author). Forking those branches global state — account config, user
// profiles — into a draft, which is wrong and could even merge back into main.
//
// The same list filters the "main" branch of `draft:member-docs`, so the set
// of documents reported there matches the docs a draft would actually fork.
//
// The principled fix is to know which documents actually belong to the draft
// and fork only those — nothing should be treated as draft content just because
// it was resolved beneath the overlay. Until we have that notion of draft
// membership we invert the problem with a blunt skip-list: it bakes app-level
// datatype names into otherwise-generic machinery and relies on each doc
// carrying a matching `@patchwork.type`.
export const SKIPPED_DATATYPES: ReadonlySet<string> = new Set([
  "account",
  "contact",
  "draft",
  "change-group",
  // Legacy marker retained while existing ChangeGroupDocs are migrated.
  "change-group-cache",
  // The Agent context-tool's chats (and their message docs) plus its per-doc
  // chat-list index: the conversation drives draft reviews (accept/reject
  // embeds), so it must stay on the real docs — a rejected draft must not
  // take the chat history or the tab list with it. Regular `chat` docs keep
  // their draft-scoped semantics. See chat/src/lib/agent-drafts.ts.
  "agent-chat",
  "agent-chats",
  // Per-account tool settings (e.g. the chat's remembered default plugins):
  // app state, not the document being drafted.
  "patchwork:tool-storage",
]);

// Whether a document is something a draft should fork, track and merge.
//
// Content carries a `@patchwork.type` naming its datatype. A doc without one
// is infrastructure — the per-session focus doc, the checked-out-draft doc,
// a chat's read positions — or a raw blob (a pasted screenshot), none of
// which anyone edits inside a draft. Forking those did real damage: a draft
// left checked out for a while accumulated well over a thousand dead clones
// of session docs, each resolved on every load and each a point of failure
// at merge time. So the rule is positive: typed, and not on the skip-list.
export function isDraftContent(doc: unknown): boolean {
  const type = (doc as { "@patchwork"?: { type?: unknown } } | undefined)?.[
    "@patchwork"
  ]?.type;
  return typeof type === "string" && !SKIPPED_DATATYPES.has(type);
}

// Reduce a url to its bare document identity by stripping any path/heads
// suffix, so urls arriving from different traversals dedupe to the same key.
export function canonicalUrl(url: AutomergeUrl): AutomergeUrl {
  const { documentId } = parseAutomergeUrl(url);
  return stringifyAutomergeUrl({ documentId });
}
