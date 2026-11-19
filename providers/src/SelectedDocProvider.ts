import { type AutomergeUrl, type Repo } from "@automerge/automerge-repo/slim";
import { accept, type SubscribeEvent } from "@inkandswitch/patchwork-providers";
import type { OpenDocumentEvent } from "@inkandswitch/patchwork-elements";
import { announce, whoAmI, type Who } from "./presence.js";

const SELECTED_DOC_SELECTOR = "patchwork:selected-doc";
const SELECTED_VIEW_SELECTOR = "patchwork:selected-view";

type SelectedView = {
  url: AutomergeUrl;
  toolId: string | null;
};

/**
 * Broadcasts the set of currently-selected document urls to any
 * `patchwork:selected-doc` subscriber, and the primary selected view
 * (`{ url, toolId }`) to any `patchwork:selected-view` subscriber.
 *
 * Selection is driven by `patchwork:open-document` events bubbling up from
 * descendant views (the sidebar, links inside the main view, etc). Opening a
 * document replaces the selection with that single url; `[0]` is the primary
 * selection.
 *
 * Selection is transient UI state, so it lives only in memory here — it is
 * never written to an Automerge doc (and therefore never synced to peers).
 *
 * It's also where you are, so others can see: while the tab is visible, the
 * open folders holding the selected doc are told you're looking at it
 * (presence.ts). A hidden tab tells them bye.
 */
export const SelectedDocProvider = (element: HTMLElement) => {
  let selectedView = selectedViewFromLocation();
  const docSubscribers = new Set<(urls: AutomergeUrl[]) => void>();
  const viewSubscribers = new Set<(view: SelectedView | null) => void>();

  // The hash says what's open, so a hash with no doc in it (Back to the bare
  // site, say) means nothing is.
  const updateSelectedViewFromLocation = () => {
    updateSelectedView(selectedViewFromLocation());
  };

  const updateSelectedView = (next: SelectedView | null) => {
    if (
      selectedView?.url === next?.url &&
      selectedView?.toolId === next?.toolId
    ) {
      return;
    }
    selectedView = next;
    for (const emit of docSubscribers) emit(selectedDocUrls());
    for (const emit of viewSubscribers) emit(selectedView);
    presence?.update();
  };

  const selectedDocUrls = (): AutomergeUrl[] => {
    return selectedView ? [selectedView.url] : [];
  };

  // ── presence ──
  const repo = () => (globalThis as { repo?: Repo }).repo;
  let me: Who | null = null;
  let asking = false;
  const findMe = () => {
    if (asking) return;
    asking = true;
    whoAmI(repo())
      .then((who) => {
        if (who) {
          me = who;
          presence.update();
        }
      })
      .finally(() => (asking = false));
  };
  const presence = announce({
    repo,
    from: `${crypto.randomUUID()}:doc`,
    where: () => {
      if (!me) findMe();
      if (document.visibilityState === "hidden" || !selectedView) return null;
      return { doc: selectedView.url };
    },
    who: () => me,
  });
  // who you are can change (a new name): asked again now and then
  const askAgain = setInterval(findMe, 60_000);
  const onVisibility = () => presence.update();

  const onOpenDocument = (event: OpenDocumentEvent) => {
    const url = event.detail.url;
    if (!url) return;
    updateSelectedView({
      url,
      toolId: event.detail.toolId ?? null,
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
  window.addEventListener("hashchange", onHashChange);
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    clearInterval(askAgain);
    presence.stop();
    element.removeEventListener(
      "patchwork:open-document",
      onOpenDocument as EventListener
    );
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    window.removeEventListener("hashchange", onHashChange);
    docSubscribers.clear();
    viewSubscribers.clear();
  };
};

const selectedViewFromLocation = (): SelectedView | null => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const doc = params.get("doc");
  if (!doc) return null;
  const url = doc.startsWith("automerge:") ? doc : `automerge:${doc}`;
  return {
    url: url as AutomergeUrl,
    toolId: params.get("tool"),
  };
};
