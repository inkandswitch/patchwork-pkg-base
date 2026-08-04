// Whether an editor is read-only is not only a property of the handle. A viewer
// that is a viewer by policy, a history view showing old heads, a draft someone
// else owns -- each has its own reason, and the editor should not have to learn
// any of them.
//
// So it asks: anything between the editor and the root can answer, and the
// editor ORs the answer with whatever the handle itself reports. No answer means
// no, which is why an editor with no host around it still edits.

import { accept, type SubscribeEvent } from "@inkandswitch/patchwork-providers";

export const READ_ONLY = "patchwork:read-only";

/** Answer `patchwork:read-only` for everything mounted inside `element`. */
export function provideReadOnly(
  element: HTMLElement,
  isReadOnly: () => boolean
): () => void {
  const onSubscribe = (event: Event) => {
    const subscribeEvent = event as SubscribeEvent;
    if (subscribeEvent.detail.selector.type !== READ_ONLY) return;
    accept<boolean>(subscribeEvent, (respond) => respond(isReadOnly()));
  };
  element.addEventListener("patchwork:subscribe", onSubscribe);
  return () => element.removeEventListener("patchwork:subscribe", onSubscribe);
}
