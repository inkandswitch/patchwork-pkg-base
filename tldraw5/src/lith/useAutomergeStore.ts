import {
  type TLAnyShapeUtilConstructor,
  type TLRecord,
  type TLStoreWithStatus,
  createTLStore,
  type TLAnyBindingUtilConstructor,
  type HistoryEntry,
  defaultUserPreferences,
  createUserId,
  type TLUser,
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

// `shapeUtils` / `bindingUtils` are the complete lists — a document script's
// `config.js` may have added to or replaced the defaults, and the store has to
// agree with the editor about them or records of a custom type fail validation.
export function useAutomergeStore({
  handle,
  shapeUtils = [],
  bindingUtils = [],
  readOnly = false,
}: {
  handle: DocHandle<TLStoreSnapshot>;
  userId: string;
  shapeUtils?: TLAnyShapeUtilConstructor[];
  bindingUtils?: TLAnyBindingUtilConstructor[];
  readOnly?: boolean;
}): TLStoreWithStatus {
  const [store] = useState(() => {
    const store = createTLStore({ shapeUtils, bindingUtils });
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
      doc,
    }: DocHandleChangePayload<TLStoreSnapshot>) => {
      if (preventPatchApplications) return;
      applyAutomergePatchesToTLStore(patches, store, doc ?? handle.doc());
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
        store: structuredClone(doc.store),
        schema: structuredClone(doc.schema),
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
  element,
}: {
  handle: DocHandle<TLStoreSnapshot>;
  store: TLStoreWithStatus;
  userMetadata: any;
  element: HTMLElement;
}) {
  const innerStore = store?.store;

  const { userId, name, color } = userMetadata;

  const isCursorActive = useIsCursorActive(element);

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
    // tldraw 5 derives presence from a `TLUser` signal rather than from local
    // user preferences, so the identity we get from the Patchwork contact goes
    // straight in instead of round-tripping through `setUserPreferences`.
    const user = computed<TLUser>("user", () => ({
      typeName: "user",
      id: createUserId(userId),
      name,
      color: color ?? defaultUserPreferences.color,
      imageUrl: "",
      meta: {},
    }));

    const presenceDerivation = createPresenceStateDerivation(user)(innerStore);

    // Closing the page sends a goodbye, which removes our record from peers.
    window.addEventListener("pagehide", stop);

    let cancelled = false;
    let dispose: (() => void) | undefined;

    if (isCursorActive) {
      dispose = react("broadcast presence", () => {
        const presence = presenceDerivation.get();
        // rAF throttles broadcasts to frame rate.
        requestAnimationFrame(() => {
          if (cancelled) return;
          // Stamp activity so becoming active again shows the cursor without
          // waiting for a pointer move to refresh the store's stale timestamp.
          update(
            "presence",
            presence ? { ...presence, lastActivityTimestamp: Date.now() } : null
          );
        });
      });
    } else {
      // Keep the record but clear the cursor when blurred or pointer leaves
      const presence = presenceDerivation.get();
      update("presence", presence ? { ...presence, cursor: null } : null);
    }

    return () => {
      // Invalidate pending rAF broadcasts so stale updates don't overwrite deactivated cursors.
      cancelled = true;
      dispose?.();
      window.removeEventListener("pagehide", stop);
    };
  }, [innerStore, userId, name, color, update, stop, isCursorActive]);
}

// The local cursor is active only when the window is focused and the pointer is over this tool.
function useIsCursorActive(element: HTMLElement) {
  const [isFocused, setIsFocused] = useState(() => document.hasFocus());
  const [isPointerOver, setIsPointerOver] = useState(() =>
    element.matches(":hover")
  );

  useEffect(() => {
    const onFocus = () => setIsFocused(true);
    const onBlur = () => setIsFocused(false);
    const onEnter = () => setIsPointerOver(true);
    const onLeave = () => setIsPointerOver(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    element.addEventListener("mouseenter", onEnter);
    element.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      element.removeEventListener("mouseenter", onEnter);
      element.removeEventListener("mouseleave", onLeave);
    };
  }, [element]);

  return isFocused && isPointerOver;
}
