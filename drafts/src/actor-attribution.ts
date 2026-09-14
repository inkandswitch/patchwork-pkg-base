import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";
import * as Automerge from "@automerge/automerge/slim";
import { subscribe } from "@inkandswitch/patchwork-providers";

import { canonicalUrl } from "./clone-policy.js";
import type { ActorAttributionDoc, DraftDoc } from "./draft-types.js";

// Only the writing client knows which Automerge actor ids are its own. Each
// local change reveals one id, which the ActorRecorder attributes to the
// current user's contact — pinned to the contact doc's heads at that moment,
// so the row keeps showing the name and picture of the time (see
// ActorAttributionDoc). Changes seen before dependencies resolve are
// buffered.
export function createActorRecorder(
  element: HTMLElement,
  repo: Repo
): ActorRecorder {
  let contactUrl: AutomergeUrl | null = null;
  // The live contact doc, for reading its heads at attribution time. Null
  // until it resolves; attributions made meanwhile are pinned to nothing
  // (a bare url), which is the pre-pinning behaviour.
  let contactHandle: DocHandle<unknown> | null = null;
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
        contactUrl = canonicalUrl(value);
        void repo.find<unknown>(contactUrl).then(
          (handle) => {
            if (disposed) return;
            contactHandle = handle;
            flushPendingActors();
          },
          () => {
            if (disposed) return;
            flushPendingActors(); // attribute unpinned rather than not at all
          }
        );
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
      const pinned = attributionHandle?.doc()?.actors?.[actorId];
      return pinned ? canonicalUrl(pinned) : null;
    },
    dispose() {
      disposed = true;
      pendingActorIds.clear();
      unsubscribe();
    },
  };

  function flushPendingActors(): void {
    if (!attributionHandle || !contactUrl || pendingActorIds.size === 0) return;
    const url = pinnedContactUrl();
    const actorIds = [...pendingActorIds];
    pendingActorIds.clear();
    for (const id of actorIds) recordedActorIds.add(id);
    const existing = attributionHandle.doc()?.actors ?? {};
    // An id already attributed to this person keeps its original pin: the
    // entry records the first time the actor wrote, and that is the moment
    // whose name and picture the rows should carry.
    const missing = actorIds.filter(
      (id) => !existing[id] || canonicalUrl(existing[id]) !== contactUrl
    );
    if (missing.length === 0) return;
    attributionHandle.change((d) => {
      for (const id of missing) d.actors[id] = url;
    });
  }

  // The contact url with the contact doc's current heads attached; bare if
  // the doc hasn't resolved (or has no changes yet).
  function pinnedContactUrl(): AutomergeUrl {
    const url = contactUrl!;
    const heads = contactHandle?.heads();
    if (!heads || heads.length === 0) return url;
    const { documentId } = parseAutomergeUrl(url);
    return stringifyAutomergeUrl({ documentId, heads });
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
  // pending, or the handle not resolved yet). Canonical (no heads pin): this
  // answers "who", and is what groups split on.
  contactFor: (actorId: string) => AutomergeUrl | null;
  dispose: () => void;
};

const CONTACT_SELECTOR = "patchwork:contact";
