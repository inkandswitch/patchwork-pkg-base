import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type DocHandleChangePayload,
  type Repo,
} from "@automerge/automerge-repo/slim";
import * as Automerge from "@automerge/automerge/slim";
import { subscribe } from "@inkandswitch/patchwork-providers";

import type { ActorAttributionDoc, DraftDoc } from "./draft-types.js";
import { editCountsSince } from "./change-group-cache.js";

// Only the writing client knows which Automerge actor ids are its own. The
// recorder watches the docs the user can currently write to (`watch`); each
// local change reveals one id, which it attributes to the current user's
// contact. The attribution doc is resolved through `resolveAttribution` only
// once there is an id to record, so viewing a document creates nothing.
// Changes seen before dependencies resolve are buffered.
export function createActorRecorder(
  element: HTMLElement,
  repo: Repo,
  resolveAttribution: () => Promise<DocHandle<ActorAttributionDoc> | null>
): ActorRecorder {
  let contactUrl: AutomergeUrl | null = null;
  let attributionHandle: DocHandle<ActorAttributionDoc> | null = null;
  let attribution: Promise<void> | null = null;
  const recordedActorIds = new Set<string>();
  const pendingActorIds = new Set<string>();
  const watched = new Map<AutomergeUrl, DocHandle<unknown> | null>();
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

  // `patchInfo.source` is "change" for remote updates too in this
  // automerge-repo build, so a local write is recognised by its actor: one of
  // the new changes was made by this doc instance's own actor id. Changes that
  // only touch `@patchwork` (tools stamping metadata on open) don't count.
  const onChange = (payload: DocHandleChangePayload<unknown>) => {
    if (disposed) return;
    const { before, after } = payload.patchInfo;
    const actorId = Automerge.getActorId(after);
    if (recordedActorIds.has(actorId)) return;
    const since = Automerge.getHeads(before);
    const ours = Automerge.getChangesMetaSince(after, since).filter(
      (meta) => meta.actor === actorId
    );
    if (ours.length === 0) return;
    void editCountsSince(after, since).then(
      (counts) => {
        if (disposed || !counts) return;
        const edited = ours.some((meta) => {
          const c = counts.get(meta.hash);
          return !!c && c.additions + c.deletions > 0;
        });
        if (!edited) return;
        pendingActorIds.add(actorId);
        flushPendingActors();
      },
      () => {}
    );
  };

  return {
    watch(urls) {
      if (disposed) return;
      const wanted = new Set(urls);
      for (const [url, handle] of [...watched]) {
        if (wanted.has(url)) continue;
        handle?.off("change", onChange);
        watched.delete(url);
      }
      for (const url of wanted) {
        if (watched.has(url)) continue;
        watched.set(url, null);
        repo.find<unknown>(url).then(
          (handle) => {
            if (disposed || watched.get(url) !== null) return;
            watched.set(url, handle);
            handle.on("change", onChange);
          },
          () => {
            if (watched.get(url) === null) watched.delete(url);
          }
        );
      }
    },
    dispose() {
      disposed = true;
      pendingActorIds.clear();
      for (const [, handle] of watched) handle?.off("change", onChange);
      watched.clear();
      unsubscribe();
    },
  };

  function flushPendingActors(): void {
    if (disposed || !contactUrl || pendingActorIds.size === 0) return;
    if (!attributionHandle) {
      attribution ??= resolveAttribution().then(
        (handle) => {
          if (disposed) return;
          attributionHandle = handle;
          if (handle) flushPendingActors();
        },
        (err) => {
          attribution = null;
          console.warn("[drafts] failed to resolve actor attribution:", err);
        }
      );
      return;
    }
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
  watch: (urls: readonly AutomergeUrl[]) => void;
  dispose: () => void;
};

const CONTACT_SELECTOR = "patchwork:contact";
