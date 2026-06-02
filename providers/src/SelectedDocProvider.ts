import { type AutomergeUrl } from "@automerge/automerge-repo";
import { accept, type SubscribeEvent } from "@inkandswitch/patchwork-providers";
import type { OpenDocumentEvent } from "@inkandswitch/patchwork-elements";

const SELECTOR = "patchwork:selected-doc";

/**
 * Broadcasts the set of currently-selected document urls to any
 * `patchwork:selected-doc` subscriber.
 *
 * Selection is driven by `patchwork:open-document` events bubbling up from
 * descendant views (the sidebar, links inside the main view, etc). Opening a
 * document replaces the selection with that single url; the ordered list is
 * kept for parity with the old `$selectedDocUrls` observable, where `[0]` is
 * the primary selection.
 *
 * Selection is transient UI state, so it lives only in memory here — it is
 * never written to an Automerge doc (and therefore never synced to peers).
 */
export const SelectedDocProvider = (element: HTMLElement) => {
  let selected: AutomergeUrl[] = [];
  const subscribers = new Set<(urls: AutomergeUrl[]) => void>();

  const onOpenDocument = (event: OpenDocumentEvent) => {
    const url = event.detail.url;
    if (!url) return;
    if (selected.length === 1 && selected[0] === url) return;
    selected = [url];
    for (const emit of subscribers) emit(selected);
  };

  const onSubscribe = (event: SubscribeEvent) => {
    if (event.detail.selector.type !== SELECTOR) return;
    accept<AutomergeUrl[]>(event, (respond) => {
      respond(selected);
      subscribers.add(respond);
      return () => {
        subscribers.delete(respond);
      };
    });
  };

  element.addEventListener(
    "patchwork:open-document",
    onOpenDocument as EventListener
  );
  element.addEventListener("patchwork:subscribe", onSubscribe);

  return () => {
    element.removeEventListener(
      "patchwork:open-document",
      onOpenDocument as EventListener
    );
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    subscribers.clear();
  };
};
