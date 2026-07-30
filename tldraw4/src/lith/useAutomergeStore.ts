import {
  type TLAnyShapeUtilConstructor,
  type TLRecord,
  type TLStoreWithStatus,
  createTLStore,
  defaultShapeUtils,
  type HistoryEntry,
  getUserPreferences,
  setUserPreferences,
  defaultUserPreferences,
  createPresenceStateDerivation,
  InstancePresenceRecordType,
  computed,
  react,
  type TLStoreSnapshot,
  type TLInstancePresence,
  sortById,
} from "@tldraw/tldraw";
import { useEffect, useState } from "react";
import {
  type DocHandle,
  type DocHandleChangePayload,
} from "@automerge/automerge-repo/slim";
import { usePresence } from "@automerge/automerge-repo-react-hooks";

import { applyAutomergePatchesToTLStore } from "./AutomergeToTLStore.js";
import { applyTLStoreChangesToAutomerge } from "./TLStoreToAutomerge.js";

export function useAutomergeStore({
  handle,
  shapeUtils = [],
  readOnly = false,
}: {
  handle: DocHandle<TLStoreSnapshot>;
  userId: string;
  shapeUtils?: TLAnyShapeUtilConstructor[];
  readOnly?: boolean;
}): TLStoreWithStatus {
  const [store] = useState(() => {
    const store = createTLStore({
      shapeUtils: [...defaultShapeUtils, ...shapeUtils],
    });
    return store;
  });

  const [storeWithStatus, setStoreWithStatus] = useState<TLStoreWithStatus>({
    status: "loading",
  });

  /* -------------------- TLDraw <--> Automerge -------------------- */
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    // A hacky workaround to prevent local changes from being applied twice
    // once into the automerge doc and then back again.
    let preventPatchApplications = false;

    /* TLDraw to Automerge */
    function syncStoreChangesToAutomergeDoc({
      changes,
    }: HistoryEntry<TLRecord>) {
      preventPatchApplications = true;
      handle.change((doc) => {
        applyTLStoreChangesToAutomerge(doc, changes);
      });
      preventPatchApplications = false;
    }

    // A read-only (history-pinned) handle is at fixed heads and rejects
    // `handle.change`, so never forward store edits back to Automerge.
    if (!readOnly) {
      unsubs.push(
        store.listen(syncStoreChangesToAutomergeDoc, {
          source: "user",
          scope: "document",
        })
      );
    }

    /* Automerge to TLDraw */
    const syncAutomergeDocChangesToStore = ({
      patches,
    }: DocHandleChangePayload<any>) => {
      if (preventPatchApplications) return;
      applyAutomergePatchesToTLStore(patches, store);
    };

    handle.on("change", syncAutomergeDocChangesToStore);
    unsubs.push(() => handle.off("change", syncAutomergeDocChangesToStore));

    /* Load the initial document snapshot into the store. */
    // TODO: need to think through the various status possibilities here and how they map
    const doc = handle.doc();
    if (!doc) throw new Error("Document not found");
    if (!doc.store) throw new Error("Document store not initialized");

    store.mergeRemoteChanges(() => {
      store.loadStoreSnapshot({
        store: JSON.parse(JSON.stringify(doc.store)),
        schema: JSON.parse(JSON.stringify(doc.schema)),
      });
    });

    setStoreWithStatus({
      store,
      status: "synced-remote",
      connectionStatus: "online",
    });

    return () => {
      unsubs.forEach((fn) => fn());
      unsubs.length = 0;
    };
  }, [handle, store, readOnly]);

  return storeWithStatus;
}

// Ephemeral state shared with peers: our tldraw presence record, or null if window is not focused
type PresenceChannels = { presence: TLInstancePresence | null };

export function useAutomergePresence({
  handle,
  store,
  userMetadata,
}: {
  handle: DocHandle<TLStoreSnapshot>;
  store: TLStoreWithStatus;
  userMetadata: any;
}) {
  const innerStore = store?.store;

  const { userId, name, color } = userMetadata;

  const isFocused = useIsFocused();

  const { peerStates, update, stop } = usePresence<PresenceChannels>({
    handle,
    initialState: { presence: null },
  });

  useEffect(() => {
    if (!innerStore) return;

    // Records are keyed by peerId so multiple sessions of the same user stay distinct.
    const toPut: TLRecord[] = peerStates.peers
      .filter((peer) => peer.value?.presence)
      .map((peer) => ({
        ...peer.value.presence!,
        id: InstancePresenceRecordType.createId(peer.peerId),
      }));

    const toRemove = innerStore.query
      .records("instance_presence")
      .get()
      .sort(sortById)
      .map((record) => record.id)
      .filter((id) => !toPut.find((record) => record.id === id));

    if (toRemove.length) innerStore.remove(toRemove);
    if (toPut.length) innerStore.put(toPut);
  }, [innerStore, peerStates]);

  useEffect(() => {
    if (!innerStore) return;
    setUserPreferences({ id: userId, color, name });

    const userPreferences = computed<{
      id: string;
      color: string;
      name: string;
    }>("userPreferences", () => {
      const user = getUserPreferences();
      return {
        id: user.id,
        color: user.color ?? defaultUserPreferences.color,
        name: user.name ?? defaultUserPreferences.name,
      };
    });

    const presenceDerivation =
      createPresenceStateDerivation(userPreferences)(innerStore);

    // Closing the page sends a goodbye, which removes our record from peers.
    window.addEventListener("pagehide", stop);

    let cancelled = false;
    let dispose: (() => void) | undefined;

    if (isFocused) {
      dispose = react("broadcast presence", () => {
        const presence = presenceDerivation.get();
        // rAF throttles broadcasts to frame rate.
        requestAnimationFrame(() => {
          if (cancelled) return;
          // Stamp activity so refocusing shows the cursor without waiting for
          // a pointer move to refresh the store's stale timestamp.
          update(
            "presence",
            presence ? { ...presence, lastActivityTimestamp: Date.now() } : null
          );
        });
      });
    } else {
      // While blurred, keep the record but drop the cursor, which tldraw
      // renders as nothing. Removing the record would drop the collaborator
      // count on peers, and tldraw only writes pointer updates while
      // collaborators exist (InputsManager gates on getCollaborators()).
      const presence = presenceDerivation.get();
      update("presence", presence ? { ...presence, cursor: null } : null);
    }

    return () => {
      // Invalidate pending rAF broadcasts so a stale one can't overwrite the
      // cursor-less broadcast sent when this effect re-runs on blur.
      cancelled = true;
      dispose?.();
      window.removeEventListener("pagehide", stop);
    };
  }, [innerStore, userId, name, color, update, stop, isFocused]);
}

function useIsFocused() {
  const [isFocused, setIsFocused] = useState(() => document.hasFocus());

  useEffect(() => {
    const onFocus = () => setIsFocused(true);
    const onBlur = () => setIsFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return isFocused;
}
