import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";

/**
 * GFM task list checkboxes: each `[ ]` / `[x]` marker in a list item is drawn
 * as a checkbox, and clicking it flips the character between the brackets.
 *
 * Needs the GFM markdown base (`markdownLanguage`), which is what parses the
 * `TaskMarker` node. Lives in the same bundle as the `markdown()` call so that
 * `syntaxTree` reads the same `Language` facet (see the note in embed.ts).
 */
class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: TaskWidget) {
    return other.checked === this.checked;
  }

  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-task";
    box.checked = this.checked;
    box.disabled = !view.state.facet(EditorView.editable);
    box.setAttribute("aria-label", this.checked ? "Done" : "To do");
    // mousedown, not click: keeps focus/selection where it was and stops
    // CodeMirror from moving the cursor onto the line.
    box.addEventListener("mousedown", (event) => {
      // only the main button ticks it: a right-click is for the list menu.
      if (event.button !== 0) return;
      event.preventDefault();
      if (box.disabled) return;
      toggle(view, view.posAtDOM(box));
    });
    return box;
  }

  ignoreEvent() {
    return true;
  }
}

/** Flip the task marker starting at `from` (the `[`). */
function toggle(view: EditorView, from: number) {
  const marker = view.state.doc.sliceString(from, from + 3);
  if (!/^\[[ xX]\]$/.test(marker)) return;
  const insert = marker[1] === " " ? "x" : " ";
  view.dispatch({
    changes: { from: from + 1, to: from + 2, insert },
    userEvent: "input.toggle-task",
  });
}

const doneMark = Decoration.mark({ class: "cm-task-done" });

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== "TaskMarker") return;
        const checked = doc.sliceString(node.from + 1, node.to - 1) !== " ";
        builder.add(
          node.from,
          node.to,
          Decoration.replace({ widget: new TaskWidget(checked) })
        );
        // Fade a done task's text (the `Task` node runs from the marker to
        // the end of the item's paragraph; nested lists sit outside it).
        const task = node.node.parent;
        if (checked && task?.name === "Task" && task.to > node.to) {
          builder.add(node.to, task.to, doneMark);
        }
      },
    });
  }
  return builder.finish();
}

export const taskCheckboxes = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      // The tree changes as the parser catches up, not only on edits.
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);
