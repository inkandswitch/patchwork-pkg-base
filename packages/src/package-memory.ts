// How much memory a package's documents take to load, measured by the site's
// automerge worker: the worker is what loads them, to serve the package's
// files. By default it says what it has loaded of a package, measured as it
// loaded each document, which costs nothing to ask. Asked to walk, it loads
// every document in the package to measure it. Asked over a
// BroadcastChannel, so a site whose worker can't measure just never says it
// heard the request.
//
// The shapes are the bootloader's (PACKAGE_MEMORY_CHANNEL in
// @inkandswitch/patchwork-bootloader/types), copied: tools only reach the
// worker at runtime.

const CHANNEL = "@patchwork/package-memory";

/**
 * One document in a package. What it costs automerge to load grows faster
 * than its ops: much faster for one big change than for the same ops spread
 * over many. A file's text written as a plain string in one change is an op
 * per character, all in that change; one of 585k characters took ~300 MB of
 * wasm memory to load, where as an `ImmutableString` it took none.
 */
export interface PackageMemoryDocument {
  url: string;
  /** Where in the package it is, `""` for the root. */
  path: string;
  ops: number;
  changes: number;
  /** The ops in its biggest single change. */
  largestChange: number;
  /** How a file doc's `content` is stored, and how long it is. */
  content?: { kind: "text" | "immutable" | "bytes"; length: number };
  /** Set if it couldn't be found, and the counts are 0. */
  error?: string;
}

export interface PackageMemory {
  documents: PackageMemoryDocument[];
  /** Set if the package couldn't be measured; `documents` has what was. */
  error?: string;
}

/** How long to wait for the worker to say it heard. */
const ACCEPT_TIMEOUT_MS = 5_000;

export class CantMeasure extends Error {}

/**
 * Ask the worker about the package at `url`: what it has loaded of it, or
 * with `walk`, every document in it. A walk measures one package at a time,
 * loading its documents one at a time and letting each go once it's
 * measured; documents it hasn't stored yet are fetched, so it can take a
 * while, and a document with one huge change costs the worker that much
 * memory to measure.
 */
export function measurePackage(
  url: string,
  { walk = false }: { walk?: boolean } = {}
): Promise<PackageMemory> {
  const channel = new BroadcastChannel(CHANNEL);
  const id = crypto.randomUUID();
  return new Promise<PackageMemory>((resolve, reject) => {
    const unheard = setTimeout(
      () => reject(new CantMeasure("This site's automerge worker can't measure packages.")),
      ACCEPT_TIMEOUT_MS
    );
    channel.addEventListener("message", ({ data }) => {
      if (data?.id !== id) return;
      if (data.type === "accepted") clearTimeout(unheard);
      if (data.type !== "reply") return;
      clearTimeout(unheard);
      resolve({ documents: data.documents ?? [], error: data.error });
    });
    channel.postMessage({ id, type: "request", url, walk });
  }).finally(() => channel.close());
}

/** The document that would cost the most to load: the one with the biggest change. */
export function heaviest(
  documents: PackageMemoryDocument[]
): PackageMemoryDocument | undefined {
  let worst: PackageMemoryDocument | undefined;
  for (const d of documents) {
    if (!worst || d.largestChange > worst.largestChange) worst = d;
  }
  return worst;
}

/**
 * A change this big is worth a look: one of 200k ops took ~24 MB to load,
 * one of 585k ~300 MB.
 */
export const HEAVY_CHANGE_OPS = 100_000;

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** How a file's content is stored, for people. */
export function describeContent(
  content: PackageMemoryDocument["content"]
): string | undefined {
  if (!content) return undefined;
  const size = formatCount(content.length);
  switch (content.kind) {
    case "text":
      return `${size} chars of text`;
    case "immutable":
      return `${size} chars, ImmutableString`;
    case "bytes":
      return `${size} bytes`;
  }
}
