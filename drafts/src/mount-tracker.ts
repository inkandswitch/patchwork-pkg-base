import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import type {
  MountedEvent,
  UnmountedEvent,
} from "@inkandswitch/patchwork-elements";

import { canonicalUrl } from "./clone-policy.js";

// The docs mounted beneath `element`, from bubbling `patchwork:mounted` /
// `patchwork:unmounted` events. Ref-counted so a doc shown in several views is
// only dropped on its last unmount.
export function createMountTracker(element: HTMLElement): MountTracker {
  const counts = new Map<AutomergeUrl, number>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const onMounted = (event: MountedEvent) => {
    const detail = event.detail;
    if (!("url" in detail)) return;
    const url = canonicalUrl(detail.url);
    counts.set(url, (counts.get(url) ?? 0) + 1);
    notify();
  };

  const onUnmounted = (event: UnmountedEvent) => {
    const detail = event.detail;
    if (!("url" in detail)) return;
    const url = canonicalUrl(detail.url);
    const count = counts.get(url) ?? 0;
    if (count <= 1) counts.delete(url);
    else counts.set(url, count - 1);
    notify();
  };

  element.addEventListener("patchwork:mounted", onMounted);
  element.addEventListener("patchwork:unmounted", onUnmounted);

  return {
    urls: () => [...counts.keys()],
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      element.removeEventListener("patchwork:mounted", onMounted);
      element.removeEventListener("patchwork:unmounted", onUnmounted);
      listeners.clear();
      counts.clear();
    },
  };
}

export type MountTracker = {
  urls: () => AutomergeUrl[];
  onChange: (listener: () => void) => () => void;
  dispose: () => void;
};
