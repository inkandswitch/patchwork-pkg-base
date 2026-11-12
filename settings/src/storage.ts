// a tool's own doc in the account: account.toolStorage[toolId]. the page
// reads it straight off the account doc (which is what it's open on) so that
// just looking at settings makes nothing. the first time something's written,
// it asks the frame's tool-storage provider for it, which makes it and links
// it into the account
import { createMemo, createSignal, onCleanup } from "solid-js";
import { isValidAutomergeUrl, type AutomergeUrl, type DocHandle } from "@automerge/automerge-repo/slim";
import { useDocument } from "solid-automerge";

type AccountWithStorage = { toolStorage?: Record<string, AutomergeUrl> };

/**
 * one `patchwork:subscribe` to the providers above `element` (the port
 * protocol patchwork-providers speaks). `onValue` hears each value; returns
 * a stop
 */
export function subscribe<T>(
  element: HTMLElement,
  selector: Record<string, unknown>,
  onValue: (value: T) => void,
): () => void {
  const target = (element.closest("patchwork-view") as HTMLElement | null) ?? element;
  const channel = new MessageChannel();
  const port = channel.port2;
  port.onmessage = (event: MessageEvent) => {
    if (event.data?.type === "change") onValue(event.data.value as T);
  };
  port.start();
  target.dispatchEvent(
    new CustomEvent("patchwork:subscribe", {
      detail: { selector, port: channel.port1 },
      bubbles: true,
      composed: true,
    }),
  );
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    try {
      port.postMessage({ type: "unsubscribe" });
    } catch {}
    port.close();
  };
}

/** the url of `toolId`'s storage, made if it isn't yet */
export function ensureToolStorage(element: HTMLElement, toolId: string): Promise<AutomergeUrl> {
  return new Promise((resolve) => {
    const stop = subscribe<string>(element, { type: "patchwork:tool-storage", toolId }, (url) => {
      if (!isValidAutomergeUrl(String(url ?? ""))) return;
      stop();
      resolve(url as AutomergeUrl);
    });
  });
}

/**
 * [doc, change] of `toolId`'s storage. `change` makes the doc the first
 * time, then changes it. call under a solid owner, inside a RepoContext
 */
export function useToolStorage<T extends object>(
  element: HTMLElement,
  account: () => AccountWithStorage | undefined,
  toolId: string,
  { init }: { init?: (doc: T) => void } = {},
) {
  const linked = createMemo(() => {
    const url = account()?.toolStorage?.[toolId];
    return url && isValidAutomergeUrl(url) ? url : undefined;
  });
  // the one this page made, before the account says so
  const [made, setMade] = createSignal<AutomergeUrl>();
  const url = () => linked() ?? made();
  const [doc, handle] = useDocument<T>(url);

  let making: Promise<DocHandle<T>> | null = null;
  let alive = true;
  onCleanup(() => (alive = false));

  async function ready(): Promise<DocHandle<T> | undefined> {
    const current = handle();
    if (current) return current;
    making ??= ensureToolStorage(element, toolId).then(async (found) => {
      if (alive) setMade(found);
      const repo = (element as unknown as { repo: { find<D>(url: AutomergeUrl): Promise<DocHandle<D>> } }).repo;
      const found_ = await repo.find<T>(found);
      if (init) found_.change((d) => init(d as T));
      return found_;
    });
    try {
      return await making;
    } finally {
      making = null;
    }
  }

  async function change(fn: (doc: T) => void) {
    (await ready())?.change((d) => fn(d as T));
  }

  return [doc, change] as const;
}
