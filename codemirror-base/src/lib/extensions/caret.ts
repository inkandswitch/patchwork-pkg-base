/** CodeMirror */
import {
  EditorView,
  ViewPlugin,
  type PluginValue,
  type ViewUpdate,
} from "@codemirror/view";
import { EditorState, Transaction, type Extension } from "@codemirror/state";

/**
 * Keep the person's caret where they can see it when text moves under it.
 *
 * - a paste (or a text drop) can carry the caret a long way, so it's put in
 *   the middle, not just inside the edge
 * - text that appears above the caret without moving it (someone else's
 *   edit, something dropped in) leaves the caret where it was on the
 *   screen. codemirror on its own keeps the top line still, so text arriving
 *   between the top and the caret pushes the caret down. a caret that's off
 *   the screen is left to codemirror
 */
export function createCaretExtension(): Extension {
  return [centerAfterPaste, keepCaretInPlace];
}

const centerAfterPaste = EditorState.transactionExtender.of((tr) =>
  tr.docChanged &&
  tr.selection &&
  (tr.isUserEvent("input.paste") || tr.isUserEvent("input.drop"))
    ? {
        effects: EditorView.scrollIntoView(tr.newSelection.main.head, {
          y: "center",
        }),
      }
    : null
);

class KeepCaretInPlace implements PluginValue {
  // the caret's top, from the top of the scroller, or null when it's out of
  // sight
  offset: number | null = null;
  onScroll = () => this.record();

  readonly view: EditorView;
  constructor(view: EditorView) {
    this.view = view;
    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
    view.requestMeasure({ key: this, read: () => this.record() });
  }

  record() {
    const view = this.view;
    const coords = view.coordsAtPos(view.state.selection.main.head, 1);
    const top = coords
      ? coords.top - view.scrollDOM.getBoundingClientRect().top
      : null;
    this.offset =
      top != null && top >= 0 && top <= view.scrollDOM.clientHeight
        ? top
        : null;
  }

  update(update: ViewUpdate) {
    // the doc changed, and nothing moved the caret: it was carried along
    const carried =
      update.docChanged &&
      update.transactions.every((tr) => !tr.docChanged || !tr.selection);
    if (carried) {
      const head = update.startState.selection.main.head;
      let above = false;
      update.changes.iterChangedRanges((fromA) => {
        if (fromA < head) above = true;
      });
      const offset = this.offset;
      if (above && offset != null) {
        // (a view can't dispatch while it's updating)
        queueMicrotask(() => {
          const view = this.view;
          if (!view.dom.isConnected) return;
          view.dispatch({
            effects: EditorView.scrollIntoView(view.state.selection.main.head, {
              y: "start",
              // codemirror adds its scroll margins on top of this
              yMargin: Math.max(0, offset - scrollMarginTop(view)),
            }),
          });
        });
      }
      return;
    }
    // their own doing, or the editor resized: where the caret is now. (the
    // scroll that follows, if any, records it again)
    if (
      update.geometryChanged ||
      update.transactions.some(
        (tr) => tr.annotation(Transaction.userEvent) != null
      )
    ) {
      this.view.requestMeasure({ key: this, read: () => this.record() });
    }
  }

  destroy() {
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
  }
}

const keepCaretInPlace = ViewPlugin.fromClass(KeepCaretInPlace);

function scrollMarginTop(view: EditorView) {
  let top = 0;
  for (const source of view.state.facet(EditorView.scrollMargins)) {
    const margins = source(view);
    if (margins?.top != null) top = Math.max(top, margins.top);
  }
  return top;
}
