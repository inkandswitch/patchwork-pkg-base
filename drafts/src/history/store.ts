import { sameHeads } from "./grouping.js";
import type { GroupKey, Heads, HistoryGroup } from "./types.js";

const DB_NAME = "patchwork-history";
// Bump to discard every index (they rebuild on demand), e.g. when the group
// gap or the edit counting changes.
const DB_VERSION = 1;

// How far an index of one document has caught up. `fromHeads` is where its
// history starts: `[]` for the whole document, or a fork point.
export type HistoryIndex = {
  documentId: string;
  fromHeads: Heads;
  toHeads: Heads;
};

type StoredGroup = HistoryGroup & {
  documentId: string;
  indexFromHeads: Heads;
};

export type LoadedIndex = { toHeads: Heads; groups: HistoryGroup[] };

export type HistoryStore = {
  load: (documentId: string, fromHeads: Heads) => Promise<LoadedIndex | null>;
  // Writes the groups and moves the index to `toHeads`, unless someone else
  // moved it off `baseHeads` first. Resolves false in that case.
  commit: (
    index: HistoryIndex,
    baseHeads: Heads,
    upsert: HistoryGroup[],
    remove: GroupKey[]
  ) => Promise<boolean>;
};

export async function openHistoryStore(): Promise<HistoryStore> {
  const db = await openDatabase();
  return {
    async load(documentId, fromHeads) {
      const tx = db.transaction(["indexes", "groups"], "readonly");
      const index = await request<HistoryIndex | undefined>(
        tx.objectStore("indexes").get([documentId, fromHeads])
      );
      if (!index) return null;
      const stored = await request<StoredGroup[]>(
        tx.objectStore("groups").getAll(groupsOf(documentId, fromHeads))
      );
      return { toHeads: index.toHeads, groups: stored.map(withoutIndex) };
    },

    async commit(index, baseHeads, upsert, remove) {
      const tx = db.transaction(["indexes", "groups"], "readwrite");
      const indexes = tx.objectStore("indexes");
      const groups = tx.objectStore("groups");
      const stored = await request<HistoryIndex | undefined>(
        indexes.get([index.documentId, index.fromHeads])
      );
      if (!sameHeads(stored?.toHeads ?? index.fromHeads, baseHeads)) {
        tx.abort();
        return false;
      }
      for (const key of remove) {
        groups.delete([index.documentId, index.fromHeads, key.actor, key.fromHeads]);
      }
      for (const group of upsert) {
        groups.put({
          ...group,
          documentId: index.documentId,
          indexFromHeads: index.fromHeads,
        } satisfies StoredGroup);
      }
      indexes.put(index);
      await done(tx);
      return true;
    },
  };
}

function openDatabase(): Promise<IDBDatabase> {
  const open = indexedDB.open(DB_NAME, DB_VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name);
    db.createObjectStore("indexes", { keyPath: ["documentId", "fromHeads"] });
    db.createObjectStore("groups", {
      keyPath: ["documentId", "indexFromHeads", "actor", "fromHeads"],
    });
  };
  return request(open);
}

// Every group of one index: keys that start with [documentId, fromHeads]. An
// array sorts after any string, so `[]` bounds every actor.
function groupsOf(documentId: string, fromHeads: Heads): IDBKeyRange {
  return IDBKeyRange.bound([documentId, fromHeads], [documentId, fromHeads, []]);
}

function withoutIndex(stored: StoredGroup): HistoryGroup {
  const { documentId: _documentId, indexFromHeads: _indexFromHeads, ...group } = stored;
  return group;
}

function request<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}
