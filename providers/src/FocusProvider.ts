import type { DocHandle, RefUrl, Repo } from "@automerge/automerge-repo";
import {
  provide,
  type RequestEvent,
} from "@inkandswitch/patchwork-providers";

const SELECTOR = "patchwork:focus";

// Shared store describing where the user's attention is.
//   - `selection`: single active range, owned by the cursor producer (the
//     active editor); writers replace the whole map atomically.
//   - `highlight`: auxiliary emphasis any view may contribute; the editor
//     renders selection ∪ highlight, with overlap drawn more intensely.
// Two fields instead of one because a single shared `selection` would
// create a feedback loop between the editor and any view writing back.
export type FocusDoc = {
  selection: Record<RefUrl, true>;
  highlight: Record<RefUrl, true>;
};

export const FocusProvider = (element: HTMLElement) => {
  const repo = (window as unknown as { repo?: Repo }).repo;
  if (!repo) {
    console.warn("[providers/focus] window.repo is not set; focus disabled");
    return () => {};
  }

  const handle = repo.create<FocusDoc>({
    selection: {},
    highlight: {},
  });

  const onRequest = (event: RequestEvent) => {
    if (event.detail.type !== SELECTOR) return;
    provide(event, handle as DocHandle<unknown>);
  };

  element.addEventListener("patchwork:request", onRequest);

  return () => {
    element.removeEventListener("patchwork:request", onRequest);
    handle.delete();
  };
};
