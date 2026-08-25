import type { AutomergeUrl } from "@automerge/automerge-repo/slim";

// Provenance is a generalization of comments: a link between references,
// e.g. a text range in one document and an element generated from it in
// another. Entries are stored in the GENERATED document, pointing back at
// their sources — the source document knows nothing about them, which is why
// the provider (see `ProvenanceProvider`) exists to invert the links for
// anything mounted alongside it.
export type DocWithProvenance = {
  "@provenance"?: {
    entries: ProvenanceEntry[];
  };
};

export type ProvenanceEntry = {
  id: string;
  /** What in the storing doc was generated — always automerge urls (a ref url
   *  into the doc, or the bare doc url for whole-document provenance). */
  targets: AutomergeUrl[];
  /** Where it came from — always automerge urls, typically cursor-anchored
   *  ref urls into the source doc (edit-stable), or a bare doc url. */
  sources: AutomergeUrl[];
  /** Who/what generated it (a contact or agent doc). */
  contactUrl?: AutomergeUrl;
  createdAt?: number;
  note?: string;
};

/** One (source, target) pair, flattened out of a stored entry. What the
 *  provider pushes to subscribers. */
export type ProvenanceLink = {
  sourceUrl: AutomergeUrl;
  targetUrl: AutomergeUrl;
  /** Ref url of the stored entry itself, resolvable to the full record. */
  entryUrl: AutomergeUrl;
};

/** The bare document url a ref url points into (strips path and heads). */
export function docUrlOfRef(ref: AutomergeUrl): AutomergeUrl | undefined {
  const slash = ref.indexOf("/");
  const hash = ref.indexOf("#");
  const end =
    slash === -1
      ? hash === -1
        ? ref.length
        : hash
      : hash === -1
        ? slash
        : Math.min(slash, hash);
  const head = ref.slice(0, end);
  return head ? (head as AutomergeUrl) : undefined;
}

export const linksEqual = (a: ProvenanceLink, b: ProvenanceLink) =>
  a.sourceUrl === b.sourceUrl &&
  a.targetUrl === b.targetUrl &&
  a.entryUrl === b.entryUrl;

export const linkListsEqual = (a: ProvenanceLink[], b: ProvenanceLink[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!linksEqual(a[i], b[i])) return false;
  }
  return true;
};
