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
// Debug trail for forks. Every clone a draft makes is logged with the doc's
// type, the element whose handle request caused it, and a running tally by
// type, so a draft that ends up with hundreds of members can be traced back
// to whoever keeps asking for docs it shouldn't.
//
// Console filter: `:fork` shows every line from this trail (drafts and agent),
// `:merge` the merge-time summary.
const forkTally: Record<string, number> = {};
let forkCount = 0;
export function logFork(details: {
  original: string;
  cloneUrl: string;
  doc: unknown;
  draftUrl: string | null | undefined;
  requester?: EventTarget | null;
  via: string;
}): void {
  const label = typeLabel(details.doc);
  forkTally[label] = (forkTally[label] ?? 0) + 1;
  forkCount += 1;
  console.info(
    `[drafts:fork] #${String(forkCount)} ${label} ${details.original} -> ${
      details.cloneUrl
    } via ${details.via} · ${describeRequester(details.requester)}`,
    { draft: details.draftUrl, tally: { ...forkTally } }
  );
}

// The original a url is a clone of in `clones`, or null when it isn't one.
// A draft's clone map is keyed by ORIGINALS, so a clone url handed back in as
// if it were an original is not found there and would be forked again — a
// clone of a clone, carrying the whole history of the first, and a fresh
// member on every hop. Callers use this to refuse that fork and name the
// requester that leaked the clone url.
export function cloneOwner(
  clones: Record<string, { cloneUrl: string }> | undefined,
  url: string
): string | null {
  if (!clones) return null;
  for (const [original, entry] of Object.entries(clones)) {
    if (canonicalUrl(entry.cloneUrl as AutomergeUrl) === url) return original;
  }
  return null;
}

export function logCloneReentry(details: {
  cloneUrl: string;
  original: string;
  draftUrl: string | null | undefined;
  requester?: EventTarget | null;
  via: string;
}): void {
  console.warn(
    `[drafts:fork] REFUSED clone-of-clone: ${details.cloneUrl} is already this ` +
      `draft's clone of ${details.original}; asked via ${details.via} · ${describeRequester(
        details.requester
      )}`,
    { draft: details.draftUrl }
  );
}

export function typeLabel(doc: unknown): string {
  const type = (doc as { "@patchwork"?: { type?: unknown } } | undefined)?.[
    "@patchwork"
  ]?.type;
  return typeof type === "string" ? type : "(untyped)";
}

// A short description of the element behind a handle request: its tag, the
// attributes that say what it shows, and the nearest enclosing
// <patchwork-view>'s tool — enough to name the culprit.
export function describeRequester(target: EventTarget | null | undefined): string {
  if (!(target instanceof Element)) return target ? String(target) : "(none)";
  const attrs = ["tool-id", "doc-url", "url", "component", "id"]
    .map((name) => {
      const value = target.getAttribute(name);
      return value ? `${name}="${value.slice(0, 60)}"` : null;
    })
    .filter(Boolean)
    .join(" ");
  const view = target.closest("patchwork-view");
  const viewTool =
    view && view !== target ? view.getAttribute("tool-id") ?? view.getAttribute("component") : null;
  return `<${target.tagName.toLowerCase()}${attrs ? " " + attrs : ""}>${
    viewTool ? ` in <patchwork-view ${viewTool}>` : ""
  }`;
}

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
