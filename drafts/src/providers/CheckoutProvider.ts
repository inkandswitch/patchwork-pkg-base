import {
  isValidAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo/slim";
import { accept, type SubscribeEvent } from "@inkandswitch/patchwork-providers";

import type { DraftCheckpoint, DraftSelection } from "../draft-types.js";
import { canonicalUrl } from "../clone-policy.js";

const CHECKOUT_SELECTOR = "checkout";
const CHECKOUTS_SELECTOR = "checkouts";
const SET_CHECKOUT_SELECTOR = "checkout:set";

const MAIN: DraftSelection = { checkedOut: null, at: null };

// The checked-out draft (and checkpoint) of every draft root in the frame, so
// each overlay on a root shows the same thing: the document column's and the
// sidebar's. In memory only; `draft=` carries the open root's across reloads.
//   - `checkout { root }` → DraftSelection, pushed on every change
//   - `checkouts`         → root → checked-out draft, pushed on every change
//   - `checkout:set { root, checkedOut, at }` → sets it, answers true
// A root nobody has set is on main.
export const CheckoutProvider = (element: HTMLElement) => {
  const checkouts = new Map<AutomergeUrl, DraftSelection>();
  const rootSubscribers = new Map<
    AutomergeUrl,
    Set<(selection: DraftSelection) => void>
  >();
  const summarySubscribers = new Set<
    (drafts: Record<AutomergeUrl, AutomergeUrl | null>) => void
  >();

  element.addEventListener("patchwork:subscribe", onSubscribe);
  return () => {
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    rootSubscribers.clear();
    summarySubscribers.clear();
  };

  function onSubscribe(event: SubscribeEvent): void {
    const selector = event.detail.selector as Record<string, unknown>;

    if (selector.type === CHECKOUT_SELECTOR) {
      const root = rootOf(selector);
      if (!root) return;
      accept<DraftSelection>(event, (respond) => {
        respond(checkouts.get(root) ?? MAIN);
        let set = rootSubscribers.get(root);
        if (!set) rootSubscribers.set(root, (set = new Set()));
        set.add(respond);
        return () => {
          set!.delete(respond);
        };
      });
      return;
    }

    if (selector.type === CHECKOUTS_SELECTOR) {
      accept<Record<AutomergeUrl, AutomergeUrl | null>>(event, (respond) => {
        respond(summary());
        summarySubscribers.add(respond);
        return () => {
          summarySubscribers.delete(respond);
        };
      });
      return;
    }

    if (selector.type === SET_CHECKOUT_SELECTOR) {
      const root = rootOf(selector);
      const next = selectionFrom(selector);
      if (!root || !next) return;
      accept<boolean>(event, (respond) => {
        set(root, next);
        respond(true);
      });
    }
  }

  function set(root: AutomergeUrl, next: DraftSelection): void {
    const previous = checkouts.get(root) ?? MAIN;
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    checkouts.set(root, next);
    for (const respond of rootSubscribers.get(root) ?? []) respond(next);
    if (previous.checkedOut === next.checkedOut) return;
    const drafts = summary();
    for (const respond of summarySubscribers) respond(drafts);
  }

  function summary(): Record<AutomergeUrl, AutomergeUrl | null> {
    const out: Record<AutomergeUrl, AutomergeUrl | null> = {};
    for (const [root, selection] of checkouts) out[root] = selection.checkedOut;
    return out;
  }
};

function rootOf(selector: Record<string, unknown>): AutomergeUrl | null {
  const { root } = selector;
  return typeof root === "string" && isValidAutomergeUrl(root)
    ? canonicalUrl(root)
    : null;
}

// A copy, since it's kept and posted to every subscriber.
function selectionFrom(
  selector: Record<string, unknown>
): DraftSelection | null {
  const { checkedOut, at } = selector;
  if (checkedOut !== null && !isValidAutomergeUrl(checkedOut)) return null;
  if (typeof at !== "object") return null;
  return {
    checkedOut,
    at: at === null ? null : (JSON.parse(JSON.stringify(at)) as DraftCheckpoint),
  };
}
