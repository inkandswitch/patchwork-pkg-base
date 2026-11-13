import { createEffect, onCleanup, type Accessor } from "solid-js";
import { subscribe } from "@inkandswitch/patchwork-providers";
import { useTaggedComponents } from "../hooks";

/** The call's video (the call package's `context-tool`). */
const CALL_VIDEO = "call-video";

/**
 * Shows the call's video tab while it's wanted. While there's a Call tab in
 * the context sidebar, threepane tells the call provider it can show the
 * video (a `patchwork:call-video` subscription), so "in the sidebar" is
 * offered as a place for faces. When that's chosen, in a call, the answer
 * says `wanted: true` and the tab is opened; when it stops (hung up, or
 * faces floating again) the tab that was showing before comes back, unless
 * you've moved on from the call's yourself.
 *
 * `element` must sit inside the call provider.
 */
export function CallVideoOpener(props: {
  element: HTMLElement;
  selected: Accessor<string | undefined>;
  select: (id: string) => void;
  open: (id: string) => void;
}) {
  const tools = useTaggedComponents("context-tool");
  const canShow = () => tools().some((t) => t.id === CALL_VIDEO);

  createEffect(() => {
    if (!canShow()) return;
    let previous: string | undefined;
    let opened = false;
    const unsubscribe = subscribe<{ wanted?: boolean }>(
      props.element,
      { type: "patchwork:call-video" },
      ({ wanted }) => {
        if (wanted) {
          if (opened) return;
          previous = props.selected();
          opened = true;
          props.open(CALL_VIDEO);
          return;
        }
        if (opened && props.selected() === CALL_VIDEO && previous) {
          props.select(previous);
        }
        opened = false;
      }
    );
    onCleanup(unsubscribe);
  });

  return null;
}
