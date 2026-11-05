import * as Automerge from "@automerge/automerge/slim";
import {
  decodeHeads,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
  type UrlHeads,
} from "@automerge/automerge-repo/slim";

import type { CloneEntry } from "./draft-types.js";

// Where a draft reads `url` when nothing pins it: its clone once it has one,
// else the doc it was forked from, frozen at the fork point.
export function entryReadUrl(url: AutomergeUrl, entry: CloneEntry): AutomergeUrl {
  if (entry.cloneUrl) return entry.cloneUrl;
  return stringifyAutomergeUrl({
    documentId: parseAutomergeUrl(entry.source ?? url).documentId,
    heads: entry.clonedAt,
  });
}

// Clone `handle`'s doc as of `to`. When `to` is where the doc already is,
// that's a plain clone.
export function cloneAt(
  repo: Repo,
  handle: DocHandle<unknown>,
  to: UrlHeads
): DocHandle<unknown> {
  if (sameHeads(handle.heads(), to)) return repo.clone(handle);
  if (to.length === 0) return repo.create<unknown>();
  return cloneAtVersion(repo, handle, to);
}

// --- Cloning a member at a version -------------------------------------------
// The obvious way — `repo.clone(handle.view(to))`, i.e. wasm `fork_at` — is
// broken upstream: on documents whose history contains certain concurrent
// merge changes (as anything synced through subduction ends up with),
// `fork_at` panics with `MissingOps` in `ChangeCollector::from_build_meta`
// at *any* heads, and the panic poisons the doc object for the rest of the
// session (every later call throws "recursive use of an object detected").
// Confirmed offline against automerge 3.3.0-fragments.1 and .2 with a
// 26-change minimal repro.
//
// So the version clone is built without `fork_at`: collect the ancestor
// closure of the pin heads from the change metadata, bundle exactly those
// changes (`saveBundle`), hydrate a fresh doc from the bundle
// (`loadIncremental`), and install it into a new repo handle — the same move
// `repo.clone` performs internally, minus the panicking wasm path. The
// resulting doc's heads are exactly `to`, it shares history with the
// original, and merges back cleanly.

// Build a clone of `handle`'s doc pinned to the `to` heads and register it
// with the repo. Throws (a plain JS error, no wasm panic) when the pin's
// ancestry can't be resolved from the doc's change metadata.
export function cloneAtVersion(
  repo: Repo,
  handle: DocHandle<unknown>,
  to: UrlHeads
): DocHandle<unknown> {
  const doc = handle.doc() as Automerge.Doc<unknown>;
  const pinHeads = decodeHeads(to);

  // Ancestor closure of the pin heads, walked over the full change metadata.
  const metas = Automerge.getChangesMetaSince(doc, []);
  const byHash = new Map(metas.map((m) => [m.hash, m]));
  const closure = new Set<string>();
  const stack = [...pinHeads];
  while (stack.length > 0) {
    const hash = stack.pop()!;
    if (closure.has(hash)) continue;
    const meta = byHash.get(hash);
    if (!meta) {
      throw new Error(
        `[drafts] change ${hash} is not in the doc's history metadata`
      );
    }
    closure.add(hash);
    stack.push(...meta.deps);
  }

  const bundle = Automerge.saveBundle(doc, [...closure]);
  const pinned = Automerge.loadIncremental(Automerge.init<unknown>(), bundle);

  const gotHeads = [...Automerge.getHeads(pinned)].sort();
  const wantHeads = [...pinHeads].sort();
  if (JSON.stringify(gotHeads) !== JSON.stringify(wantHeads)) {
    throw new Error(
      `[drafts] version clone heads mismatch: wanted ${wantHeads}, got ${gotHeads}`
    );
  }

  const clone = repo.create<unknown>();
  clone.update(() => pinned);
  return clone;
}

function sameHeads(a: UrlHeads, b: UrlHeads): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((h) => set.has(h));
}
