import {
  isImmutableString,
  isValidAutomergeUrl,
  type AutomergeUrl,
  type Repo,
} from "@automerge/automerge-repo/slim";
import { getRegistry } from "@inkandswitch/patchwork-plugins";

import { canonicalUrl } from "./clone-policy.js";

// Which documents belong to a draft: the host doc plus everything reachable
// from it through embedded-document links. A datatype decides its own
// document's links by implementing `getEmbeddedDocuments(doc)`; without one,
// every `automerge:` url in the doc's content counts (see
// `defaultEmbeddedDocuments`). Links a datatype leaves out stay shared with
// main. Contacts are never members.

// A guard against enormous graphs, not against cycles (the visited set
// handles those).
const MAX_MEMBERS = 500;

// How long a burst of edits to a member settles before its links are
// re-walked.
const REWALK_DEBOUNCE_MS = 250;

// Reads a member's content, or `undefined` when it has none to contribute
// (e.g. it didn't exist yet at a pinned version).
export type ReadDoc = (url: AutomergeUrl) => Promise<unknown>;

export type CollectOptions = {
  // Members already walked: not read or expanded again, and left out of the
  // result, unless they are roots.
  known?: ReadonlySet<AutomergeUrl>;
  embeddedDocumentsOf?: (doc: unknown) => Promise<AutomergeUrl[]>;
};

// Walk breadth-first from `roots`, returning every member reached (roots
// first). Each url is canonicalized to its bare document id, so paths, pinned
// heads, and cycles all collapse onto one visit per document.
export async function collectDraftMembers(
  roots: readonly AutomergeUrl[],
  readDoc: ReadDoc,
  options: CollectOptions = {}
): Promise<AutomergeUrl[]> {
  const known = options.known ?? new Set<AutomergeUrl>();
  const embeddedDocumentsOf =
    options.embeddedDocumentsOf ?? getEmbeddedDocuments;
  const rootUrls = new Set(roots.map(canonicalUrl));
  const visited = new Set<AutomergeUrl>();
  const members: AutomergeUrl[] = [];
  let frontier = [...rootUrls];

  while (frontier.length > 0 && members.length < MAX_MEMBERS) {
    const batch: AutomergeUrl[] = [];
    for (const url of frontier) {
      if (visited.has(url)) continue;
      visited.add(url);
      if (known.has(url) && !rootUrls.has(url)) continue;
      batch.push(url);
    }
    const links = await Promise.all(batch.map(readLinks));
    frontier = [];
    for (let i = 0; i < batch.length; i++) {
      const found = links[i];
      if (!found) continue;
      if (members.length >= MAX_MEMBERS) {
        console.warn(
          `[drafts] draft membership capped at ${MAX_MEMBERS} documents`
        );
        break;
      }
      members.push(batch[i]);
      frontier.push(...found.map(canonicalUrl));
    }
  }
  return members;

  async function readLinks(url: AutomergeUrl): Promise<AutomergeUrl[] | null> {
    let doc: unknown;
    try {
      doc = await readDoc(url);
    } catch (err) {
      console.warn(`[drafts] couldn't read ${url} for draft membership:`, err);
      return null;
    }
    if (doc == null || isContact(doc)) return null;
    const links = await embeddedDocumentsOf(doc);
    return links.filter((link) => isValidAutomergeUrl(link));
  }
}

// A document's embedded documents: its datatype's `getEmbeddedDocuments`
// when it has one, the default scan otherwise. A throwing implementation
// falls back to the default, which forks more rather than less.
export async function getEmbeddedDocuments(
  doc: unknown
): Promise<AutomergeUrl[]> {
  const custom = await loadGetEmbeddedDocuments(patchworkType(doc));
  if (custom) {
    try {
      return custom(doc) ?? [];
    } catch (err) {
      console.warn("[drafts] getEmbeddedDocuments threw; using the default scan:", err);
    }
  }
  return defaultEmbeddedDocuments(doc);
}

// Every `automerge:` url in a string anywhere in `doc`. Skips `@patchwork`
// subtrees (draft bookkeeping, copies, history, tool source: plumbing, not
// content) and never looks inside binary or immutable-string values.
export function defaultEmbeddedDocuments(doc: unknown): AutomergeUrl[] {
  const urls = new Set<AutomergeUrl>();
  visit(doc);
  return [...urls];

  function visit(node: unknown): void {
    if (typeof node === "string") {
      for (const url of extractUrls(node)) urls.add(url);
      return;
    }
    if (node === null || typeof node !== "object") return;
    if (ArrayBuffer.isView(node) || isImmutableString(node)) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== "@patchwork") visit(child);
    }
  }
}

// Contacts are identities, not content: all sorts of documents link to them
// (message authors, commenters, attendees), but they belong to none of them.
export function isContact(doc: unknown): boolean {
  return patchworkType(doc) === "contact";
}

export type MembershipTracker = {
  // Resolves once every change seen so far has been walked and its new
  // members recorded.
  settled(): Promise<void>;
  dispose(): void;
};

export type TrackMembershipOptions = {
  repo: Repo;
  roots: readonly AutomergeUrl[];
  // Members recorded before tracking started (e.g. a draft's existing
  // clones): walked through, watched, and never reported as added.
  known?: Iterable<AutomergeUrl>;
  // The document a member's content is read from and watched for new links.
  backingUrl(original: AutomergeUrl): AutomergeUrl;
  // Newly reachable members. Settle once they are recorded, so `backingUrl`
  // already points at their backing when they are watched.
  onAdded(urls: AutomergeUrl[]): Promise<void> | void;
};

// Keep a membership current: walk once from the roots, then re-walk from any
// member whose backing doc changes, admitting docs it newly links to.
// Membership only grows; a removed link leaves its doc a member.
export function trackMembership(
  options: TrackMembershipOptions
): MembershipTracker {
  const { repo, backingUrl, onAdded } = options;
  const members = new Set<AutomergeUrl>();
  const unwatch = new Map<AutomergeUrl, () => void>();
  const dirty = new Set<AutomergeUrl>();
  let disposed = false;
  let tail: Promise<void> = Promise.resolve();
  let debounce: {
    timer: ReturnType<typeof setTimeout>;
    done: Promise<void>;
    resolve: () => void;
  } | null = null;

  const readDoc: ReadDoc = async (url) =>
    (await repo.find<unknown>(backingUrl(url))).doc();

  const initial = new Set([...(options.known ?? [])].map(canonicalUrl));
  run(async () => {
    const found = await collectDraftMembers(
      [...options.roots, ...initial],
      readDoc
    );
    for (const url of initial) admitKnown(url);
    await admit(found.filter((url) => !initial.has(url)));
  });

  return {
    async settled() {
      for (;;) {
        if (debounce) {
          await debounce.done;
          continue;
        }
        const current = tail;
        await current;
        if (current === tail && !debounce) return;
      }
    },
    dispose() {
      disposed = true;
      if (debounce) {
        clearTimeout(debounce.timer);
        debounce.resolve();
        debounce = null;
      }
      for (const off of unwatch.values()) off();
      unwatch.clear();
    },
  };

  function run(task: () => Promise<void>): Promise<void> {
    tail = tail.then(async () => {
      if (disposed) return;
      try {
        await task();
      } catch (err) {
        console.error("[drafts] draft membership walk failed:", err);
      }
    });
    return tail;
  }

  async function admit(urls: AutomergeUrl[]): Promise<void> {
    const fresh = urls.filter((url) => !members.has(url));
    if (fresh.length === 0 || disposed) return;
    await onAdded(fresh);
    for (const url of fresh) admitKnown(url);
  }

  function admitKnown(url: AutomergeUrl): void {
    members.add(url);
    void watch(url);
  }

  async function watch(url: AutomergeUrl): Promise<void> {
    if (unwatch.has(url) || disposed) return;
    unwatch.set(url, () => {});
    try {
      const handle = await repo.find<unknown>(backingUrl(url));
      if (disposed) return;
      const onChange = () => markDirty(url);
      handle.on("change", onChange);
      unwatch.set(url, () => handle.off("change", onChange));
    } catch {
      unwatch.delete(url);
    }
  }

  function markDirty(url: AutomergeUrl): void {
    if (disposed) return;
    dirty.add(url);
    if (debounce) return;
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    const timer = setTimeout(() => {
      debounce = null;
      const roots = [...dirty];
      dirty.clear();
      void run(async () => {
        const found = await collectDraftMembers(roots, readDoc, {
          known: members,
        });
        await admit(found);
      }).then(resolve);
    }, REWALK_DEBOUNCE_MS);
    debounce = { timer, done, resolve };
  }
}

// Over-match on a permissive charset (stopping at the delimiters that close a
// link, token, or string), trim trailing sentence punctuation, then let
// automerge validate. Sub-urls and pinned urls reduce to their document.
const URL_PATTERN = /automerge:[^\s)\]}"'`<>]+/g;

function extractUrls(text: string): AutomergeUrl[] {
  if (!text.includes("automerge:")) return [];
  const urls: AutomergeUrl[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const candidate = match[0].replace(/[.,;:!?]+$/, "");
    if (isValidAutomergeUrl(candidate)) urls.push(canonicalUrl(candidate));
  }
  return urls;
}

type WithEmbeddedDocuments = {
  getEmbeddedDocuments?: (doc: unknown) => AutomergeUrl[];
};

async function loadGetEmbeddedDocuments(
  type: string | undefined
): Promise<((doc: unknown) => AutomergeUrl[]) | undefined> {
  if (!type) return undefined;
  try {
    const datatype = await getRegistry("patchwork:datatype").load(type);
    const module = datatype?.module as WithEmbeddedDocuments | undefined;
    const method = module?.getEmbeddedDocuments;
    return typeof method === "function" ? method.bind(module) : undefined;
  } catch (err) {
    console.warn(`[drafts] couldn't load datatype ${type}:`, err);
    return undefined;
  }
}

function patchworkType(doc: unknown): string | undefined {
  if (!doc || typeof doc !== "object") return undefined;
  const meta = (doc as { "@patchwork"?: { type?: unknown } })["@patchwork"];
  return typeof meta?.type === "string" ? meta.type : undefined;
}
