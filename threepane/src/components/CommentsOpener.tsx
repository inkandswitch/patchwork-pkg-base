import { createEffect, onCleanup } from "solid-js";
import { subscribeDoc } from "@inkandswitch/patchwork-providers-solid";
import { useTaggedComponents } from "../hooks";

/** The comments context tool (comments-view's `patchwork:component`). */
const COMMENTS_TOOL_ID = "comments-view";
const OPENER_ID = "threepane-context-sidebar";

type FocusDoc = {
  commentViewOpeners?: Record<string, true>;
  openCommentView?: number;
};

/**
 * Lets an editor bring the comments sidebar up. While there's a Comments tab
 * to open, threepane lists itself in the focus doc's `commentViewOpeners`;
 * when an editor bumps `openCommentView` (a comment was clicked, or the
 * Comment button pressed, with no comments view on screen), it shows the
 * sidebar on that tab. The comments view, once on screen, lists itself in
 * `commentViews` and follows the selection to the thread — so the editor
 * needs nothing more than the ask.
 *
 * `element` must sit inside the focus provider.
 */
export function CommentsOpener(props: {
  element: HTMLElement;
  open: (toolId: string) => void;
}) {
  const [focusDoc, focusHandle] = subscribeDoc<FocusDoc>(props.element, {
    type: "patchwork:focus",
  });
  const tools = useTaggedComponents("context-tool");
  const canOpen = () => tools().some((t) => t.id === COMMENTS_TOOL_ID);

  createEffect(() => {
    const handle = focusHandle();
    if (!handle || !canOpen()) return;
    handle.change((doc) => {
      if (!doc.commentViewOpeners) doc.commentViewOpeners = {};
      doc.commentViewOpeners[OPENER_ID] = true;
    });
    onCleanup(() =>
      handle.change((doc) => {
        if (doc.commentViewOpeners) delete doc.commentViewOpeners[OPENER_ID];
      })
    );
  });

  // Only asks made from now on: not whatever count the doc already holds.
  let seen: number | undefined;
  createEffect(() => {
    const asked = focusDoc()?.openCommentView ?? 0;
    if (seen === undefined) {
      seen = asked;
      return;
    }
    if (asked === seen) return;
    seen = asked;
    if (canOpen()) props.open(COMMENTS_TOOL_ID);
  });

  return null;
}
