import type { DocHandle, RefUrl, Repo } from "@automerge/automerge-repo";
import {
  provide,
  request,
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
  let disposed = false;
  let handle: DocHandle<FocusDoc> | null = null;

  const readyPromise: Promise<DocHandle<FocusDoc> | null> = request<Repo>(
    element,
    "patchwork:repo"
  ).then((repo) => {
    if (disposed) return null;
    if (!repo) {
      console.warn(
        "[providers/focus] no `patchwork:repo` provider; focus disabled"
      );
      return null;
    }
    handle = repo.create<FocusDoc>({ selection: {}, highlight: {} });
    return handle;
  });

  const onRequest = (event: RequestEvent) => {
    if (event.detail.type !== SELECTOR) return;
    provide<DocHandle<unknown> | null>(event, handle ?? readyPromise);
  };

  element.addEventListener("patchwork:request", onRequest);

  return () => {
    disposed = true;
    element.removeEventListener("patchwork:request", onRequest);
    if (handle) handle.delete();
  };
};
