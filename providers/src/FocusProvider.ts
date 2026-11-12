import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { accept, type SubscribeEvent } from "@inkandswitch/patchwork-providers";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";

const SELECTOR = "patchwork:focus";

// Shared store describing where the user's attention is.
//   - `selection`: single active range, owned by the cursor producer (the
//     active editor); writers replace the whole map atomically.
//   - `highlight`: auxiliary emphasis any view may contribute; the editor
//     renders selection ∪ highlight, with overlap drawn more intensely.
// Two fields instead of one because a single shared `selection` would
// create a feedback loop between the editor and any view writing back.
//   - `commentViews`: the views showing comment threads on screen right now,
//     each under an id of its own; a view adds itself while visible and
//     removes itself when hidden or gone. While any is listed, an editor
//     leaves threads to them rather than opening its own inline popover.
export type FocusDoc = {
  selection: Record<AutomergeUrl, true>;
  highlight: Record<AutomergeUrl, true>;
  commentViews: Record<string, true>;
};

export const FocusProvider = (element: PatchworkViewElement) => {
  const handle = element.repo.create<FocusDoc>({
    selection: {},
    highlight: {},
    commentViews: {},
  });

  // Consumers recover the live handle from the global repo via this url, so
  // they can both read (projection) and write (`.change`) the same doc.
  const onSubscribe = (event: SubscribeEvent) => {
    if (event.detail.selector.type !== SELECTOR) return;
    accept<AutomergeUrl>(event, (respond) => {
      respond(handle.url);
    });
  };

  element.addEventListener("patchwork:subscribe", onSubscribe);

  return () => {
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    handle.delete();
  };
};
