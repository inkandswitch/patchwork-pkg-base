// Keeps per-document history indexes in IndexedDB. The page sends the
// documents it watches (a full save first, then what changed since), and the
// worker groups each actor's changes, stores the groups, and answers every
// watch with updates. Other tabs' workers share the database; a BroadcastChannel
// tells them when an index moved.
import * as Automerge from "@automerge/automerge/slim";
import automergeWasm from "@automerge/automerge/automerge.wasm?url";

import { createIndexer, type MovesChannel } from "./indexer.js";
import { openHistoryStore } from "./store.js";
import type { FromWorker, ToWorker } from "./types.js";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  postMessage: (message: FromWorker) => void;
};

const store = Automerge.initializeWasm(
  new URL(automergeWasm, import.meta.url).href
).then(openHistoryStore);

const receive = createIndexer(
  store,
  (message) => scope.postMessage(message),
  new BroadcastChannel("patchwork-history") as MovesChannel
);
scope.onmessage = (event) => receive(event.data);
