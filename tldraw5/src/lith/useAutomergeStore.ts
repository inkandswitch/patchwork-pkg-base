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
  sortById,
} from "@tldraw/tldraw";
import { useEffect, useState } from "react";
import {
  type DocHandle,
  type DocHandleChangePayload,
} from "@automerge/automerge-repo/slim";
import {
  useLocalAwareness,
  useRemoteAwareness,
} from "@automerge/automerge-repo-react-hooks";

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

  const [, updateLocalState] = useLocalAwareness({
    handle,
    userId,
    initialState: {},
  });

  const [peerStates] = useRemoteAwareness({
    handle,
    localUserId: userId,
  });

  /* ----------- Presence stuff ----------- */
  useEffect(() => {
    if (!innerStore) return;

    const toPut: TLRecord[] = Object.values(peerStates).filter(
      (record) => record && Object.keys(record).length !== 0
    );

    // put / remove the records in the store
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
    /* ----------- Presence stuff ----------- */
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

    const presenceId = InstancePresenceRecordType.createId(userId);
    const presenceDerivation = createPresenceStateDerivation(user, {
      instanceId: presenceId,
    })(innerStore);

    return react("when presence changes", () => {
      const presence = presenceDerivation.get();
      requestAnimationFrame(() => {
        updateLocalState(presence);
      });
    });
  }, [innerStore, userId, updateLocalState]);
  /* ----------- End presence stuff ----------- */
}
