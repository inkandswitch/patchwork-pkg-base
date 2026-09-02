import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";
import * as Automerge from "@automerge/automerge/slim";
import { subscribe } from "@inkandswitch/patchwork-providers";

import type { ActorAttributionDoc, DraftDoc } from "./draft-types.js";

// Only the writing client knows which Automerge actor ids are its own. Each
// local change reveals one id, which the ActorRecorder attributes to the
// current user's contact. Changes seen before dependencies resolve are
// buffered.
export function createActorRecorder(element: HTMLElement): ActorRecorder {
  let contactUrl: AutomergeUrl | null = null;
  let attributionHandle: DocHandle<ActorAttributionDoc> | null = null;
  const recordedActorIds = new Set<string>();
  const pendingActorIds = new Set<string>();
  let disposed = false;

  const unsubscribe = subscribe<AutomergeUrl>(
    element,
    { type: CONTACT_SELECTOR },
    (value) => {
      if (disposed || contactUrl) return;
      if (typeof value === "string" && isValidAutomergeUrl(value)) {
        contactUrl = value;
        flushPendingActors();
      }
    }
  );

  return {
    recordLocalChange(doc) {
      if (disposed) return;
      let actorId: string;
      try {
        actorId = Automerge.getActorId(doc);
      } catch {
        return;
      }
      if (recordedActorIds.has(actorId)) return;
      pendingActorIds.add(actorId);
      flushPendingActors();
    },
    setAttributionHandle(handle) {
      if (disposed) return;
      attributionHandle = handle;
      flushPendingActors();
    },
    contactFor(actorId) {
      return attributionHandle?.doc()?.actors?.[actorId] ?? null;
    },
    dispose() {
      disposed = true;
      pendingActorIds.clear();
      unsubscribe();
    },
  };

  function flushPendingActors(): void {
    if (!attributionHandle || !contactUrl || pendingActorIds.size === 0) return;
    const url = contactUrl;
    const actorIds = [...pendingActorIds];
    pendingActorIds.clear();
    for (const id of actorIds) recordedActorIds.add(id);
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
// pattern as `ensureChangeGroupDoc`: the rare concurrent-create orphan is
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
  // settled (our fresh doc is then an accepted orphan, like a group doc).
  const settled = mainDraftHandle.doc()?.actorAttributionUrl;
  if (settled && settled !== attribution.url && isValidAutomergeUrl(settled)) {
    return repo.find<ActorAttributionDoc>(settled);
  }
  return attribution;
}

export type ActorRecorder = {
  recordLocalChange: (doc: Automerge.Doc<unknown>) => void;
  setAttributionHandle: (handle: DocHandle<ActorAttributionDoc>) => void;
  // The contact an actor id is attributed to — ANY writer's, not just this
  // client's (the attribution doc syncs). Null while unknown (attribution
  // pending, or the handle not resolved yet).
  contactFor: (actorId: string) => AutomergeUrl | null;
  dispose: () => void;
};

const CONTACT_SELECTOR = "patchwork:contact";
