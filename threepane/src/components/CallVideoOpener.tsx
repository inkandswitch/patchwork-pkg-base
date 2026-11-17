import { createEffect, onCleanup, type Accessor } from "solid-js";
import { subscribe } from "@inkandswitch/patchwork-providers";
import { useTaggedComponents } from "../hooks";
import { CALL_PROVIDER } from "../datatypes";

/** The call's video (the call package's `context-tool`). */
const CALL_VIDEO = "call-video";

/**
 * Shows the call's video tab while it's wanted. While there's a Call tab in
 * the context sidebar, threepane tells the call provider it can show the
 * video (a `patchwork:call-video` subscription, saying whether the tab is on
 * screen now), so "in the sidebar" is offered as a place for faces, and
 * faces float whenever the tab isn't showing. When the video's wanted (in a
 * call, faces in the sidebar) the tab is opened; when it stops (hung up, or
 * faces floating again) the tab that was showing before comes back, unless
 * you've moved on from the call's yourself.
 *
 * Lives above the per-document remount, so what it opened survives a doc
 * switch. It must sit inside the call provider.
 */
export function CallVideoOpener(props: {
  selected: Accessor<string | undefined>;
  select: (id: string | undefined) => void;
  open: (id: string) => void;
  isCollapsed: Accessor<boolean>;
}) {
  let anchor!: HTMLSpanElement;
  const tools = useTaggedComponents("context-tool");
  const canShow = () => tools().some((t) => t.id === CALL_VIDEO);
  const showing = () => !props.isCollapsed() && props.selected() === CALL_VIDEO;

  let previous: string | undefined;
  let opened = false;
  function heard({ wanted }: { wanted?: boolean }) {
    if (wanted) {
      if (opened) return;
      previous = props.selected();
      opened = true;
      if (!showing()) props.open(CALL_VIDEO);
      return;
    }
    // (none chosen before: none again, which shows the first tab)
    if (
      opened &&
      props.selected() === CALL_VIDEO &&
      previous !== CALL_VIDEO
    ) {
      props.select(previous);
    }
    opened = false;
  }

  createEffect(() => {
    if (!canShow()) return;
    const selector = { type: "patchwork:call-video", showing: showing() };
    const listen = () =>
      subscribe<{ wanted?: boolean }>(anchor, selector, heard);
    let unsubscribe = listen();
    // a provider that turns up after this asked (loaded late, or swapped in
    // anew) is asked again
    const again = (event: Event) => {
      if ((event as CustomEvent).detail?.componentId !== CALL_PROVIDER) return;
      unsubscribe();
      unsubscribe = listen();
    };
    addEventListener("patchwork:mounted", again);
    onCleanup(() => {
      removeEventListener("patchwork:mounted", again);
      unsubscribe();
    });
  });

  return <span hidden ref={anchor} />;
}
