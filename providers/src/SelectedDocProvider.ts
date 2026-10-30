import { type AutomergeUrl } from "@automerge/automerge-repo/slim";
import { accept, type SubscribeEvent } from "@inkandswitch/patchwork-providers";
import type { OpenDocumentEvent } from "@inkandswitch/patchwork-elements";

const SELECTED_DOC_SELECTOR = "patchwork:selected-doc";
/**
 * A tool says which parts of the document it shows are selected (a tldraw
 * canvas's shapes): `{ url, parts }`, where `url` is that document and each
 * part an `automerge:<id>/<path>` url into it. They join the selection, so
 * whatever lists them (the sidebar) can show them selected, without the
 * document being opened again.
 */
const SELECT_PARTS_EVENT = "patchwork:select-parts";
const SELECTED_VIEW_SELECTOR = "patchwork:selected-view";

type SelectedView = {
  url: AutomergeUrl;
  toolId: string | null;
  /**
   * The live path it was opened at (`<acctHash>/Projects/foo`, each segment
   * still encoded), when whoever opened it said; a tool gets it as
   * `<patchwork-view path>`.
   */
  path?: string;
};

/**
 * Broadcasts the set of currently-selected document urls to any
 * `patchwork:selected-doc` subscriber, and the primary selected view
 * (`{ url, toolId, path? }`) to any `patchwork:selected-view` subscriber.
 *
 * Selection is driven by `patchwork:open-document` events bubbling up from
 * descendant views (the sidebar, links inside the main view, etc). Opening a
 * document replaces the selection with that single url; `[0]` is the primary
 * selection.
 *
 * Selection is transient UI state, so it lives only in memory here — it is
 * never written to an Automerge doc (and therefore never synced to peers).
 */
const documentIdOf = (url: string) => url.replace(/^automerge:/, "").split(/[/#]/)[0];
/** The document a part url (`automerge:<id>/<path>`) is part of, with its heads; undefined for a whole one. */
const containerOf = (url: string): AutomergeUrl | undefined => {
  const [base, heads] = url.split("#");
  const [document, ...segments] = base.split("/");
  if (!segments.length || !document.startsWith("automerge:")) return undefined;
  return (heads === undefined ? document : `${document}#${heads}`) as AutomergeUrl;
};

export const SelectedDocProvider = (element: HTMLElement) => {
  let selectedView = selectedViewFromLocation();
  // The parts the tool says are selected; undefined until it says.
  let selectedParts: AutomergeUrl[] | undefined;
  const docSubscribers = new Set<(urls: AutomergeUrl[]) => void>();
  const viewSubscribers = new Set<(view: SelectedView | null) => void>();

  const updateSelectedViewFromLocation = () => {
    const next = selectedViewFromLocation();
    if (!next) return;
    updateSelectedView(next);
  };

  const updateSelectedView = (next: SelectedView) => {
    if (
      selectedView?.url === next.url &&
      selectedView?.toolId === next.toolId &&
      selectedView?.path === next.path
    ) {
      return;
    }
    if (!selectedView || documentIdOf(selectedView.url) !== documentIdOf(next.url)) {
      selectedParts = undefined;
    }
    selectedView = next;
    for (const emit of docSubscribers) emit(selectedDocUrls());
    for (const emit of viewSubscribers) emit(selectedView);
  };

  /**
   * What's open first, then the parts selected in it. When what's open is
   * itself a part (a shape opened from the sidebar), the document it's part of
   * comes first and the part after it, until the tool says what it has
   * selected: from then on, that.
   */
  const selectedDocUrls = (): AutomergeUrl[] => {
    if (!selectedView) return [];
    const view = selectedView.url;
    const document = containerOf(view);
    if (!document) return [view, ...(selectedParts ?? [])];
    return [document, ...(selectedParts ?? [view])];
  };

  const onSelectParts = (event: Event) => {
    const { url, parts } = ((event as CustomEvent).detail ?? {}) as {
      url?: string;
      parts?: unknown;
    };
    if (!selectedView || !url || !Array.isArray(parts)) return;
    // Only parts of what's open: a tool showing something else isn't the selection.
    const id = documentIdOf(selectedView.url);
    if (documentIdOf(url) !== id) return;
    const next = parts.filter(
      (part): part is AutomergeUrl => typeof part === "string" && documentIdOf(part) === id
    );
    const previous = selectedParts;
    if (previous && next.length === previous.length && next.every((part, i) => part === previous[i])) {
      return;
    }
    selectedParts = next;
    for (const emit of docSubscribers) emit(selectedDocUrls());
  };

  const onOpenDocument = (event: OpenDocumentEvent) => {
    const url = event.detail.url;
    if (!url) return;
    const path = (event.detail as { path?: string }).path;
    updateSelectedView({
      url,
      toolId: event.detail.toolId ?? null,
      ...(path ? { path } : {}),
    });
  };

  const onHashChange = () => {
    updateSelectedViewFromLocation();
  };

  const onSubscribe = (event: SubscribeEvent) => {
    if (event.detail.selector.type === SELECTED_DOC_SELECTOR) {
      accept<AutomergeUrl[]>(event, (respond) => {
        respond(selectedDocUrls());
        docSubscribers.add(respond);
        return () => docSubscribers.delete(respond);
      });
    }
    if (event.detail.selector.type === SELECTED_VIEW_SELECTOR) {
      accept<SelectedView | null>(event, (respond) => {
        respond(selectedView);
        viewSubscribers.add(respond);
        return () => viewSubscribers.delete(respond);
      });
    }
  };

  element.addEventListener(
    "patchwork:open-document",
    onOpenDocument as EventListener
  );
  element.addEventListener("patchwork:subscribe", onSubscribe);
  element.addEventListener(SELECT_PARTS_EVENT, onSelectParts);
  window.addEventListener("hashchange", onHashChange);

  return () => {
    element.removeEventListener(
      "patchwork:open-document",
      onOpenDocument as EventListener
    );
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    element.removeEventListener(SELECT_PARTS_EVENT, onSelectParts);
    window.removeEventListener("hashchange", onHashChange);
    docSubscribers.clear();
    viewSubscribers.clear();
  };
};

const selectedViewFromLocation = (): SelectedView | null => {
  const hash = window.location.hash.slice(1);
  const params = new URLSearchParams(hash);
  const doc = params.get("doc");
  if (!doc) return null;
  const url = doc.startsWith("automerge:") ? doc : `automerge:${doc}`;
  // Read raw: its segments are encoded, and URLSearchParams would decode an
  // encoded slash in a name into a real one.
  const path = /(?:^|&)path=([^&]*)/.exec(hash)?.[1];
  return {
    url: url as AutomergeUrl,
    toolId: params.get("tool"),
    ...(path ? { path } : {}),
  };
};
