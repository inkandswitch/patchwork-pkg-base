import {
  decodeHeads,
  encodeHeads,
  isValidAutomergeUrl,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
  type UrlHeads,
} from "@automerge/automerge-repo/slim";
import * as Automerge from "@automerge/automerge/slim";
import { accept, type SubscribeEvent } from "@inkandswitch/patchwork-providers";

import { CrossOriginWorker as Worker } from "./cross-origin-worker.js";
import {
  HISTORY_GROUPS_SELECTOR,
  type FromWorker,
  type Heads,
  type HistoryGroupsUpdate,
  type ToWorker,
} from "./types.js";

// Coalesce bursts of edits into one message to the worker.
const FEED_DEBOUNCE_MS = 250;

type HistoryClient = {
  watch: (
    url: AutomergeUrl,
    fromHeads: UrlHeads,
    respond: (update: HistoryGroupsUpdate<UrlHeads>) => void
  ) => () => void;
};

// Answers `{ type: "history:groups", url, fromHeads? }` with a document's
// history grouped per actor, from `fromHeads` on (the whole history when
// absent). The first answer resets; later ones carry only what changed.
// Indexes are built on first request and kept in IndexedDB by a worker, so
// they're cheap to ask for again.
export const HistoryProvider = (element: HTMLElement, repo: Repo) => {
  const client = clientFor(repo);

  const onSubscribe = (event: SubscribeEvent) => {
    const { selector } = event.detail;
    if (selector.type !== HISTORY_GROUPS_SELECTOR) return;
    const { url, fromHeads } = selector;
    if (typeof url !== "string" || !isValidAutomergeUrl(url)) {
      console.warn("[history] history:groups needs a valid url, got", url);
      return;
    }
    const from = Array.isArray(fromHeads) ? (fromHeads as UrlHeads) : ([] as unknown as UrlHeads);
    accept<HistoryGroupsUpdate<UrlHeads>>(event, (respond) =>
      client.watch(url, from, respond)
    );
  };

  element.addEventListener("patchwork:subscribe", onSubscribe);
  return () => element.removeEventListener("patchwork:subscribe", onSubscribe);
};

const clients = new WeakMap<Repo, HistoryClient>();

function clientFor(repo: Repo): HistoryClient {
  let client = clients.get(repo);
  if (!client) clients.set(repo, (client = createClient(repo)));
  return client;
}

// One worker per repo. Each watched document is fed to it once, however many
// subscriptions ask for it.
function createClient(repo: Repo): HistoryClient {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
  const responders = new Map<number, (update: HistoryGroupsUpdate) => void>();
  const feeds = new Map<string, Feed>();
  let nextSub = 0;

  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    const { sub, update } = event.data;
    responders.get(sub)?.(update);
  };
  worker.onerror = (event) => {
    console.error("[history] worker failed:", event.message);
  };

  return {
    watch(url, fromHeads, respond) {
      const { documentId } = parseAutomergeUrl(url);
      const sub = nextSub++;
      responders.set(sub, (update) => respond(toUrlHeads(update)));
      const feed = feedFor(documentId);
      feed.refs++;
      send({ type: "watch", sub, documentId, fromHeads: hexHeads(fromHeads) });
      return () => {
        responders.delete(sub);
        send({ type: "unwatch", sub });
        if (--feed.refs === 0) feed.stop();
      };
    },
  };

  function send(message: ToWorker): void {
    worker.postMessage(message);
  }

  function feedFor(documentId: string): Feed {
    let feed = feeds.get(documentId);
    if (!feed) {
      feed = startFeed(repo, documentId, send, () => feeds.delete(documentId));
      feeds.set(documentId, feed);
    }
    return feed;
  }
}

type Feed = { refs: number; stop: () => void };

// Sends the worker the document, then whatever changed since the last send.
function startFeed(
  repo: Repo,
  documentId: string,
  send: (message: ToWorker) => void,
  onStop: () => void
): Feed {
  let handle: DocHandle<unknown> | null = null;
  let sent: Automerge.Heads | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const flush = () => {
    timer = null;
    const doc = handle?.doc() as Automerge.Doc<unknown> | undefined;
    if (stopped || !doc) return;
    const heads = Automerge.getHeads(doc);
    if (sent && sameHeads(heads, sent)) return;
    const bytes = sent ? Automerge.saveSince(doc, sent) : Automerge.save(doc);
    sent = heads;
    send({ type: "changes", documentId, bytes });
  };
  const onChange = () => {
    if (timer === null) timer = setTimeout(flush, FEED_DEBOUNCE_MS);
  };

  const url = stringifyAutomergeUrl({ documentId: documentId as never });
  repo.find<unknown>(url).then(
    (found) => {
      if (stopped) return;
      handle = found;
      handle.on("change", onChange);
      flush();
    },
    (err) => {
      if (stopped) return;
      console.warn("[history] couldn't load document:", url, err);
      send({ type: "missing", documentId });
    }
  );

  const feed: Feed = {
    refs: 0,
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      handle?.off("change", onChange);
      send({ type: "drop", documentId });
      onStop();
    },
  };
  return feed;
}

function toUrlHeads(update: HistoryGroupsUpdate): HistoryGroupsUpdate<UrlHeads> {
  return {
    reset: update.reset,
    upsert: update.upsert.map((group) => ({
      ...group,
      fromHeads: encodeHeads(group.fromHeads),
      toHeads: encodeHeads(group.toHeads),
    })),
    remove: update.remove.map((key) => ({
      actor: key.actor,
      fromHeads: encodeHeads(key.fromHeads),
    })),
    toHeads: encodeHeads(update.toHeads),
    pending: update.pending,
  };
}

function hexHeads(heads: UrlHeads): Heads {
  return [...decodeHeads(heads)].sort();
}

function sameHeads(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((h) => set.has(h));
}
