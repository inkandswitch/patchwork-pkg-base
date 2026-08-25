import {
  type AutomergeUrl,
  type DocHandle,
  type DocHandleChangePayload,
  type DocHandleDeletePayload,
} from "@automerge/automerge-repo/slim";
import { accept, type SubscribeEvent } from "@inkandswitch/patchwork-providers";
import type {
  MountedEvent,
  UnmountedEvent,
  PatchworkViewElement,
} from "@inkandswitch/patchwork-elements";
import {
  type DocWithProvenance,
  type ProvenanceLink,
  docUrlOfRef,
  linkListsEqual,
} from "./provenance.js";

/**
 * Answers `patchwork:provenance` subscriptions. Watches every doc mounted
 * inside it for a `@provenance` section and pushes the resulting
 * `ProvenanceLink[]` to subscribers.
 *
 * The point of mounting this around a canvas: entries live in the GENERATED
 * doc, so a source doc (e.g. a text document) cannot see inbound links by
 * reading itself. Anything mounted in the same context can instead ask this
 * provider, which indexes links by the doc url of EITHER end.
 *
 * Subscriptions are scoped:
 *
 * - `{ url }` → only links with that doc on either end. The subscriber is
 *   re-notified only when its own slice changes.
 * - no args → the flat list of every link across all mounted docs.
 */
export const ProvenanceProvider = (element: PatchworkViewElement) => {
  // Mount bookkeeping survives the `await repo.find` below.
  const mountCounts = new Map<AutomergeUrl, number>();
  const handlesByUrl = new Map<AutomergeUrl, DocHandle<DocWithProvenance>>();

  // Two indices over the same links: keyed by the doc that *stores* the
  // entries, and regrouped by the doc url of each link's ends.
  const linksByStorageUrl = new Map<AutomergeUrl, ProvenanceLink[]>();
  let linksByDocUrl = new Map<AutomergeUrl, ProvenanceLink[]>();
  let flatLinks: ProvenanceLink[] = [];

  // Subscribers, split by the doc url they asked about (or the global set
  // for url-less subscriptions).
  const subscribersByUrl = new Map<
    AutomergeUrl,
    Set<(links: ProvenanceLink[]) => void>
  >();
  const globalSubscribers = new Set<(links: ProvenanceLink[]) => void>();

  element.addEventListener("patchwork:mounted", startWatch);
  element.addEventListener("patchwork:unmounted", stopWatch);
  element.addEventListener("patchwork:subscribe", onSubscribe);

  return () => {
    element.removeEventListener("patchwork:mounted", startWatch);
    element.removeEventListener("patchwork:unmounted", stopWatch);
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    for (const url of [...handlesByUrl.keys()]) disposeDoc(url);
    subscribersByUrl.clear();
    globalSubscribers.clear();
  };

  function onSubscribe(event: SubscribeEvent) {
    if (event.detail.selector.type !== "patchwork:provenance") return;
    const url = event.detail.selector.url as AutomergeUrl | undefined;

    accept<ProvenanceLink[]>(event, (respond) => {
      if (url) {
        respond(linksByDocUrl.get(url) ?? []);
        let set = subscribersByUrl.get(url);
        if (!set) subscribersByUrl.set(url, (set = new Set()));
        set.add(respond);
        return () => {
          set!.delete(respond);
          if (set!.size === 0) subscribersByUrl.delete(url);
        };
      }
      respond(flatLinks);
      globalSubscribers.add(respond);
      return () => globalSubscribers.delete(respond);
    });
  }

  async function startWatch(event: MountedEvent) {
    if (!("url" in event.detail)) return;
    const url = event.detail.url;
    const wasMounted = isMounted(url);
    mountDoc(url);
    if (wasMounted) return;

    let handle: DocHandle<DocWithProvenance>;
    try {
      handle = await element.repo.find<DocWithProvenance>(url);
    } catch (error) {
      console.error(`[corkboard] failed to watch provenance on ${url}`, error);
      return;
    }
    if (!isMounted(url)) return;
    if (handlesByUrl.has(url)) return;

    handle.on("change", onChange);
    handle.on("delete", onDelete);
    handlesByUrl.set(url, handle);
    linksByStorageUrl.set(url, buildLinksForDoc(handle));
    rebuild();
  }

  function stopWatch(event: UnmountedEvent) {
    if (!("url" in event.detail)) return;
    const url = event.detail.url;
    unmountDoc(url);
    if (!isMounted(url)) disposeDoc(url);
  }

  function onChange({ handle }: DocHandleChangePayload<DocWithProvenance>) {
    const prev = linksByStorageUrl.get(handle.url);
    if (!prev) return;
    const next = buildLinksForDoc(handle);
    if (linkListsEqual(prev, next)) return;
    linksByStorageUrl.set(handle.url, next);
    rebuild();
  }

  function onDelete({ handle }: DocHandleDeletePayload<DocWithProvenance>) {
    disposeDoc(handle.url);
  }

  function disposeDoc(url: AutomergeUrl) {
    const handle = handlesByUrl.get(url);
    mountCounts.delete(url);
    handlesByUrl.delete(url);
    linksByStorageUrl.delete(url);
    if (!handle) return;
    handle.off("change", onChange);
    handle.off("delete", onDelete);
    rebuild();
  }

  // Recompute both indices from the per-storage-doc lists, then notify only
  // the subscribers whose visible slice actually changed.
  function rebuild() {
    const nextFlat: ProvenanceLink[] = [];
    for (const list of linksByStorageUrl.values()) {
      for (const link of list) nextFlat.push(link);
    }

    // A link is visible from the doc of either end. When both ends live in
    // the same doc it's still listed once.
    const nextByDoc = new Map<AutomergeUrl, ProvenanceLink[]>();
    for (const link of nextFlat) {
      const ends = new Set(
        [docUrlOfRef(link.sourceUrl), docUrlOfRef(link.targetUrl)].filter(
          (u): u is AutomergeUrl => u !== undefined
        )
      );
      for (const docUrl of ends) {
        let bucket = nextByDoc.get(docUrl);
        if (!bucket) nextByDoc.set(docUrl, (bucket = []));
        bucket.push(link);
      }
    }

    const touched = new Set<AutomergeUrl>([
      ...nextByDoc.keys(),
      ...linksByDocUrl.keys(),
    ]);
    for (const url of touched) {
      const before = linksByDocUrl.get(url) ?? [];
      const after = nextByDoc.get(url) ?? [];
      if (linkListsEqual(before, after)) continue;
      const subs = subscribersByUrl.get(url);
      if (subs) for (const emit of subs) emit(after);
    }
    linksByDocUrl = nextByDoc;

    if (!linkListsEqual(flatLinks, nextFlat)) {
      flatLinks = nextFlat;
      for (const emit of globalSubscribers) emit(flatLinks);
    }
  }

  function buildLinksForDoc(
    handle: DocHandle<DocWithProvenance>
  ): ProvenanceLink[] {
    const links: ProvenanceLink[] = [];
    const entries = handle.doc()?.["@provenance"]?.entries ?? [];
    for (const entry of entries) {
      const entryUrl = handle.sub("@provenance", "entries", {
        id: entry.id,
      }).url;
      for (const targetUrl of entry.targets ?? []) {
        for (const sourceUrl of entry.sources ?? []) {
          links.push({ sourceUrl, targetUrl, entryUrl });
        }
      }
    }
    return links;
  }

  function mountDoc(url: AutomergeUrl) {
    mountCounts.set(url, (mountCounts.get(url) ?? 0) + 1);
  }

  function unmountDoc(url: AutomergeUrl) {
    const cur = mountCounts.get(url) ?? 0;
    if (cur <= 1) mountCounts.delete(url);
    else mountCounts.set(url, cur - 1);
  }

  function isMounted(url: AutomergeUrl) {
    return mountCounts.has(url);
  }
};
