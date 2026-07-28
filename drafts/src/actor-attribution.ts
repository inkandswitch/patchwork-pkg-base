import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";
import * as Automerge from "@automerge/automerge/slim";
import { subscribe } from "@inkandswitch/patchwork-providers";

import type { ActorAttributionDoc, DraftDoc } from "./draft-types.js";

const CONTACT_SELECTOR = "patchwork:contact";

// The write side of author attribution. Only the writing client knows which
// Automerge actor ids are its own (each doc instance gets a fresh one per
// session), so attribution can't be derived after the fact: every local
// change reveals one id, and the recorder stamps it into the host doc's
// shared ActorAttributionDoc as actorId -> the current user's contact url.
export type ActorRecorder = {
  // Feed from the change-group filler: `doc` just received a LOCAL change,
  // so its actor id belongs to the current user.
  onLocalChange: (doc: Automerge.Doc<unknown>) => void;
  // Point the recorder at the host doc's attribution doc once resolved.
  setAttributionHandle: (handle: DocHandle<ActorAttributionDoc>) => void;
  dispose: () => void;
};

// The current user's contact url comes from the `patchwork:contact` provider
// (the AccountProvider above the document area). Actor ids seen before it —
// or the attribution doc — resolves are buffered, not lost. If no provider
// ever answers, the mapping simply isn't written and authors fall back to
// raw actor rendering.
export function createActorRecorder(element: HTMLElement): ActorRecorder {
  let contactUrl: AutomergeUrl | null = null;
  let attributionHandle: DocHandle<ActorAttributionDoc> | null = null;
  // Actor ids already written this session (skip cheaply) vs seen while the
  // contact url or attribution doc was still resolving.
  const recorded = new Set<string>();
  const pending = new Set<string>();
  let disposed = false;

  const unsubscribe = subscribe<AutomergeUrl>(
    element,
    { type: CONTACT_SELECTOR },
    (value) => {
      if (disposed || contactUrl) return;
      if (typeof value === "string" && isValidAutomergeUrl(value)) {
        contactUrl = value;
        flush();
      }
    }
  );

  return {
    onLocalChange(doc) {
      if (disposed) return;
      let actorId: string;
      try {
        actorId = Automerge.getActorId(doc);
      } catch {
        return;
      }
      if (recorded.has(actorId)) return;
      pending.add(actorId);
      flush();
    },
    setAttributionHandle(handle) {
      if (disposed) return;
      attributionHandle = handle;
      flush();
    },
    dispose() {
      disposed = true;
      pending.clear();
      unsubscribe();
    },
  };

  function flush(): void {
    if (!attributionHandle || !contactUrl || pending.size === 0) return;
    const url = contactUrl;
    const actorIds = [...pending];
    pending.clear();
    for (const id of actorIds) recorded.add(id);
    const existing = attributionHandle.doc()?.actors ?? {};
    const missing = actorIds.filter((id) => existing[id] !== url);
    if (missing.length === 0) return;
    attributionHandle.change((d) => {
      for (const id of missing) d.actors[id] = url;
    });
  }
}

// Resolve the host doc's actor-attribution doc, creating it and stamping
// `actorAttributionUrl` on the main draft the first time. One per host doc
// (actor ids span main and every draft), following the same check-then-create
// pattern as `ensureChangeGroupCache`: the rare concurrent-create orphan is
// accepted.
export async function ensureActorAttribution(
  repo: Repo,
  mainDraftHandle: DocHandle<DraftDoc>
): Promise<DocHandle<ActorAttributionDoc>> {
  const existingUrl = mainDraftHandle.doc()?.actorAttributionUrl;
  if (existingUrl && isValidAutomergeUrl(existingUrl)) {
    return repo.find<ActorAttributionDoc>(existingUrl);
  }

  const attribution = repo.create<ActorAttributionDoc>({
    "@patchwork": { type: "actor-attribution" },
    actors: {},
  });
  mainDraftHandle.change((d) => {
    if (!d.actorAttributionUrl) d.actorAttributionUrl = attribution.url;
  });
  // A concurrent creator may have won the stamp; honor whichever pointer
  // settled (our fresh doc is then an accepted orphan, same as the cache doc).
  const settled = mainDraftHandle.doc()?.actorAttributionUrl;
  if (settled && settled !== attribution.url && isValidAutomergeUrl(settled)) {
    return repo.find<ActorAttributionDoc>(settled);
  }
  return attribution;
}
