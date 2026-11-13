import { syntaxTree } from "@codemirror/language";
import { Prec, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  keymap,
  type Command,
  type DecorationSet,
} from "@codemirror/view";

/**
 * GFM task list checkboxes: each `[ ]` / `[x]` marker in a list item is drawn
 * as a checkbox, and clicking it flips the character between the brackets.
 * Mod-k (Cmd-k on a Mac) does the same for the tasks the selection is on.
 *
 * Needs the GFM markdown base (`markdownLanguage`), which is what parses the
 * `TaskMarker` node. Lives in the same bundle as the `markdown()` call so that
 * `syntaxTree` reads the same `Language` facet (see the note in embed.ts).
 */
/**
 * The box, after nextaction's: a soft rounded square. Open, it's a clear grey
 * outline; ticked, it fades back along with its task's text — a faint outline
 * and a grey tick. The tick draws itself in (a mask slides off it) only when
 * it's just been ticked, not every time a ticked task scrolls into view, and
 * the box swells a little while pressed.
 */
const SVG = "http://www.w3.org/2000/svg";

function tick(animate: boolean) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "cm-task-tick");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", "M19 7L10 16.5l-4.5-4.5");
  svg.append(path);
  if (animate) {
    // a block of the page's colour over the tick, sliding off it
    const mask = document.createElementNS(SVG, "rect");
    mask.setAttribute("class", "cm-task-tick-mask");
    for (const [k, v] of [["x", "0"], ["y", "0"], ["width", "24"], ["height", "24"]])
      mask.setAttribute(k, v);
    const slide = document.createElementNS(SVG, "animate");
    for (const [k, v] of [
      ["attributeName", "x"],
      ["values", "0;24;24"],
      ["dur", "0.24s"],
      ["begin", "0.1s"],
      ["fill", "freeze"],
    ])
      slide.setAttribute(k, v);
    mask.append(slide);
    svg.append(mask);
  }
  return svg;
}

/** When a box was last ticked: the box drawn just after animates its tick. */
const justTicked = new WeakMap<EditorView, number>();

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: TaskWidget) {
    return other.checked === this.checked;
  }

  toDOM(view: EditorView) {
    const box = document.createElement("span");
    box.className = "cm-task" + (this.checked ? " cm-task-checked" : "");
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.checked));
    box.setAttribute("aria-label", this.checked ? "Done" : "To do");
    const disabled = !view.state.facet(EditorView.editable);
    if (disabled) box.setAttribute("aria-disabled", "true");

    if (this.checked) {
      const ticked = justTicked.get(view);
      box.append(tick(ticked !== undefined && performance.now() - ticked < 400));
    }

    // mousedown, not click: keeps focus/selection where it was and stops
    // CodeMirror from moving the cursor onto the line.
    box.addEventListener("mousedown", (event) => {
      // only the main button ticks it: a right-click is for the list menu.
      if (event.button !== 0) return;
      event.preventDefault();
      if (disabled) return;
      box.classList.add("cm-task-pressed");
      const up = () => {
        box.classList.remove("cm-task-pressed");
        window.removeEventListener("mouseup", up, true);
      };
      window.addEventListener("mouseup", up, true);
      if (!this.checked) justTicked.set(view, performance.now());
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

/**
 * Tick the tasks on the selected lines, or untick them if they're all ticked
 * already. Off a task it does nothing and lets the key go.
 */
export const toggleTasks: Command = (view) => {
  const { state } = view;
  if (!state.facet(EditorView.editable) || state.readOnly) return false;
  const markers = new Map<number, boolean>();
  const tree = syntaxTree(state);
  for (const range of state.selection.ranges) {
    const from = state.doc.lineAt(range.from).from;
    const to = state.doc.lineAt(range.to).to;
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== "TaskMarker") return;
        // a task further down an item that starts above isn't on these lines
        if (node.from < from || node.from > to) return;
        markers.set(node.from, state.doc.sliceString(node.from + 1, node.to - 1) !== " ");
      },
    });
  }
  if (!markers.size) return false;
  const tick = [...markers.values()].some((done) => !done);
  if (tick) justTicked.set(view, performance.now());
  view.dispatch({
    changes: [...markers]
      .filter(([, done]) => done !== tick)
      .map(([at]) => ({ from: at + 1, to: at + 2, insert: tick ? "x" : " " })),
    userEvent: "input.toggle-task",
  });
  return true;
};

const taskKeys = Prec.high(keymap.of([{ key: "Mod-k", run: toggleTasks }]));

const motion = (ms: number) =>
  `max(1ms, calc(${ms}ms * var(--studio-motion-scale, 1) * var(--studio-motion-preference, 1)))`;

const ink = (fade: number) =>
  `color-mix(in oklab, var(--text-editor-line, currentColor), transparent ${fade}%)`;

const taskTheme = EditorView.baseTheme({
  ".cm-task": {
    // about as tall as the text, centred on it (margin.ts sets the size)
    "--cm-task-size": "var(--markdown-marker-size, 0.9em)",
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "none",
    width: "var(--cm-task-size)",
    height: "var(--cm-task-size)",
    borderRadius: "calc(var(--cm-task-size) / 3.5)",
    border: `1.5px solid ${ink(45)}`,
    color: ink(45),
    verticalAlign: "middle",
    cursor: "var(--studio-cursor-pointer, pointer)",
    userSelect: "none",
    transition: `border-color ${motion(140)} linear, color ${motion(140)} linear, scale ${motion(100)} ease`,
  },
  ".cm-task-pressed": {
    scale: "1.1",
  },
  // done: it steps back with its text (see .cm-task-done)
  ".cm-task-checked": {
    borderColor: ink(80),
    color: ink(55),
  },
  ".cm-task[aria-disabled]": {
    cursor: "default",
  },
  ".cm-task-tick": {
    width: "100%",
    height: "100%",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  ".cm-task-tick-mask": {
    fill: "var(--text-editor-fill, white)",
    stroke: "none",
  },
});

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

const taskPlugin = ViewPlugin.fromClass(
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

export const taskCheckboxes = [taskPlugin, taskTheme, taskKeys];
