import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  Prec,
  StateField,
  type ChangeSpec,
  type Range,
  type StateCommand,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  keymap,
  type DecorationSet,
} from "@codemirror/view";
import { openUrl } from "./links.ts";

/** a node of the syntax tree (@lezer/common's, which isn't a dependency here) */
type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;

/**
 * GFM tables. Away from the caret a table is drawn as a table — header,
 * column alignment, and the bold/italic/code/links/strikethrough in its
 * cells. Put the caret in it (click a cell, or arrow into it) and its source
 * shows instead, in the code font so the pipes line up. As with `---` rules,
 * the markup is there exactly while it's being edited.
 *
 * While editing, Tab and Shift-Tab go from cell to cell and Enter goes down a
 * row, each first lining the columns up. Tab in the last cell, or Enter on the
 * last row, adds a row; Enter on an empty last row takes it off and leaves the
 * table. Lining up only ever rewrites the space and pipes around a cell's
 * text, never the text itself, so it can't undo someone else's typing in it.
 *
 * Only tables at the top level: one in a quote or list keeps its `>`/`-`
 * prefix on each line, which a drawn table would hide, so it stays as source.
 *
 * Needs the GFM markdown base (`markdownLanguage`), which parses `Table`.
 */

export type Align = "left" | "center" | "right" | null;

/** A cell in a row's text: its segment between pipes, and its trimmed text. */
export type Cell = {
  /** the segment, pipes excluded */
  from: number;
  to: number;
  /** the text, spaces trimmed off; from === to when it's empty */
  textFrom: number;
  textTo: number;
};

export type Row = {
  cells: Cell[];
  /** where the leading pipe is, if the row has one */
  lead: number | null;
  /** where the trailing pipe is, if the row has one */
  trail: number | null;
};

const isSpace = (c: string | undefined) => c === " " || c === "\t";

/**
 * Split one line of a table into cells, as GFM does: at every pipe not
 * escaped with a backslash (a pipe in `code` splits it too). Positions are
 * offsets into `text`.
 */
export function splitRow(text: string): Row {
  const pipes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "|") pipes.push(i);
  }
  let start = 0;
  while (isSpace(text[start])) start++;
  let end = text.length;
  while (end > start && isSpace(text[end - 1])) end--;

  const lead = pipes[0] === start ? start : null;
  const trail =
    pipes.length && pipes.at(-1) === end - 1 && end - 1 !== lead ? end - 1 : null;

  const bounds: [number, number][] = [];
  let from = lead === null ? 0 : lead + 1;
  for (const p of pipes) {
    if (p === lead) continue;
    bounds.push([from, p]);
    from = p + 1;
  }
  if (trail === null) bounds.push([from, text.length]);

  const cells = bounds.map(([from, to]) => {
    let textFrom = from;
    while (textFrom < to && isSpace(text[textFrom])) textFrom++;
    let textTo = to;
    while (textTo > textFrom && isSpace(text[textTo - 1])) textTo--;
    return { from, to, textFrom, textTo };
  });
  return { cells, lead, trail };
}

/** The column alignments a delimiter row (`|:--|:-:|--:|`) gives. */
export function alignments(delimiter: string): Align[] {
  return splitRow(delimiter).cells.map(({ textFrom, textTo }) => {
    const cell = delimiter.slice(textFrom, textTo);
    const left = cell.startsWith(":");
    const right = cell.endsWith(":") && cell.length > 1;
    return left && right ? "center" : right ? "right" : left ? "left" : null;
  });
}

function delimiterCell(width: number, align: Align) {
  switch (align) {
    case "left":
      return ":" + "-".repeat(width - 1);
    case "right":
      return "-".repeat(width - 1) + ":";
    case "center":
      return ":" + "-".repeat(width - 2) + ":";
    default:
      return "-".repeat(width);
  }
}

/** Every column at least this wide, so a delimiter cell can say `:-:`. */
const MIN_WIDTH = 3;

/**
 * The column widths that line up `rows` (each a line of the table; the
 * second is the delimiter row, which doesn't count towards them).
 */
export function columnWidths(rows: string[]): number[] {
  const columns = splitRow(rows[0]).cells.length;
  const widths: number[] = Array(columns).fill(MIN_WIDTH);
  rows.forEach((text, i) => {
    if (i === 1) return;
    splitRow(text).cells.forEach((c, col) => {
      if (col < columns) widths[col] = Math.max(widths[col], c.textTo - c.textFrom);
    });
  });
  return widths;
}

/**
 * The edits that line up one row, as offsets into `text`: it gets a pipe at
 * each end and one space either side of each cell's text, padded out to its
 * column's width, and as many cells as the table has columns. The delimiter
 * row's cells are redrawn to the widths, keeping their alignment.
 *
 * Only the space and pipes around a cell's text change, never the text — so
 * the result of applying these is the formatted row, and applying them again
 * changes nothing.
 */
export function lineUpRow(
  text: string,
  widths: number[],
  delimiter: Align[] | null
): { from: number; to: number; insert: string }[] {
  const { cells, lead, trail } = splitRow(text);
  const changes: { from: number; to: number; insert: string }[] = [];
  const edit = (from: number, to: number, insert: string) => {
    if (text.slice(from, to) !== insert) changes.push({ from, to, insert });
  };

  // indentation before the leading pipe goes; a missing one is added (as part
  // of the first cell's leading space, below, so no two edits touch).
  if (lead !== null) edit(0, lead, "");

  cells.forEach((cell, col) => {
    const width = widths[col] ?? 0;
    const first = col === 0 && lead === null ? "| " : " ";
    // a missing trailing pipe goes after the last cell
    const close = col === cells.length - 1 && trail === null ? " |" : " ";
    if (delimiter) {
      edit(cell.from, cell.to, first + delimiterCell(width, delimiter[col] ?? null) + close);
      return;
    }
    const pad = " ".repeat(Math.max(0, width - (cell.textTo - cell.textFrom)));
    // one edit for an empty cell, so the space before and after don't touch
    if (cell.textFrom === cell.textTo) edit(cell.from, cell.to, first + pad + close);
    else {
      edit(cell.from, cell.textFrom, first);
      edit(cell.textTo, cell.to, pad + close);
    }
  });

  // short rows get empty cells to fill the table out
  let tail = "";
  for (let col = cells.length; col < widths.length; col++) {
    const width = widths[col];
    tail += " " + (delimiter ? delimiterCell(width, delimiter[col] ?? null) : " ".repeat(width)) + " |";
  }
  if (trail !== null) edit(trail + 1, text.length, tail);
  else if (tail) changes.push({ from: text.length, to: text.length, insert: tail });
  return changes;
}

/** Where column `col`'s text starts in a lined-up row (from its line start). */
export const cellStart = (widths: number[], col: number) =>
  2 + widths.slice(0, col).reduce((sum, w) => sum + w + 3, 0);

/** A table's lines, as positions in the doc. */
type Table = { from: number; to: number; lines: { from: number; to: number }[] };

/** The top-level table holding `pos`, if there is one. */
function tableAt(state: EditorState, pos: number): Table | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (node.name === "Table") return node.parent?.name === "Document" ? toTable(state, node) : null;
  }
  // at the very end of a row the inner node can be the one after it
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === "Table") return node.parent?.name === "Document" ? toTable(state, node) : null;
  }
  return null;
}

function toTable(state: EditorState, node: { from: number; to: number }): Table {
  const first = state.doc.lineAt(node.from);
  const last = state.doc.lineAt(node.to);
  const lines = [];
  for (let n = first.number; n <= last.number; n++) {
    const line = state.doc.line(n);
    lines.push({ from: line.from, to: line.to });
  }
  return { from: first.from, to: last.to, lines };
}

const lineText = (state: EditorState, line: { from: number; to: number }) =>
  state.doc.sliceString(line.from, line.to);

/**
 * Line the table up and put the caret in a cell of the result: `row` (a line
 * index, which may be one past the end: a new row is added) and `col`.
 */
function lineUpAndGo(
  state: EditorState,
  table: Table,
  row: number,
  col: number
) {
  const rows = table.lines.map((l) => lineText(state, l));
  const widths = columnWidths(rows);
  const delimiter = alignments(rows[1]);
  const changes: ChangeSpec[] = [];
  rows.forEach((text, i) => {
    for (const c of lineUpRow(text, widths, i === 1 ? delimiter : null))
      changes.push({ from: table.lines[i].from + c.from, to: table.lines[i].from + c.to, insert: c.insert });
  });
  const adding = row >= rows.length;
  if (adding) {
    const blank = "| " + widths.map((w) => " ".repeat(w)).join(" | ") + " |";
    changes.push({ from: table.to, insert: "\n" + blank });
  }
  const set = state.changes(changes);
  // where the row starts once lined up (a new row: the line after the last)
  const lineFrom = adding
    ? set.apply(state.doc).lineAt(set.mapPos(table.lines.at(-1)!.from, -1)).to + 1
    : set.mapPos(table.lines[row].from, -1);
  const cell = adding ? undefined : splitRow(lineText(state, table.lines[row])).cells[col];
  // the caret goes after the cell's text (its text never moves within it)
  const at =
    lineFrom +
    cellStart(widths, Math.min(col, widths.length - 1)) +
    (cell && col < widths.length ? cell.textTo - cell.textFrom : 0);
  return state.update({
    changes: set,
    selection: EditorSelection.cursor(at),
    scrollIntoView: true,
    userEvent: "input.table",
  });
}

/** The table, row and column the main selection's head is in. */
function where(state: EditorState) {
  if (state.selection.ranges.length !== 1) return null;
  const head = state.selection.main.head;
  const table = tableAt(state, head);
  if (!table) return null;
  const row = table.lines.findIndex((l) => head >= l.from && head <= l.to);
  if (row < 0) return null;
  const offset = head - table.lines[row].from;
  const { cells } = splitRow(lineText(state, table.lines[row]));
  let col = cells.findIndex((c) => offset <= c.to);
  if (col < 0) col = cells.length - 1;
  return { table, row, col: Math.max(0, col), columns: splitRow(lineText(state, table.lines[0])).cells.length };
}

const editable = (state: EditorState) =>
  state.facet(EditorView.editable) && !state.readOnly;

export const nextCell: StateCommand = ({ state, dispatch }) => {
  const at = where(state);
  if (!at || !editable(state)) return false;
  let { row, col } = at;
  col++;
  if (col >= at.columns) {
    col = 0;
    row++;
  }
  if (row === 1) row = 2; // past the delimiter row
  dispatch(lineUpAndGo(state, at.table, row, col));
  return true;
};

export const previousCell: StateCommand = ({ state, dispatch }) => {
  const at = where(state);
  if (!at || !editable(state)) return false;
  let { row, col } = at;
  col--;
  if (col < 0) {
    col = at.columns - 1;
    row--;
  }
  if (row === 1) row = 0;
  if (row < 0) return true; // the first cell: stay, don't leave the editor
  dispatch(lineUpAndGo(state, at.table, row, col));
  return true;
};

export const nextRow: StateCommand = ({ state, dispatch }) => {
  const at = where(state);
  if (!at || !editable(state) || !state.selection.main.empty) return false;
  const { table, row, col } = at;
  const last = row === table.lines.length - 1;
  const line = table.lines[row];
  const empty = splitRow(lineText(state, line)).cells.every((c) => c.textFrom === c.textTo);
  if (last && row > 1 && empty) {
    // an empty last row: take it off and carry on below the table, after a
    // blank line (a line of text right under a table would be another row)
    dispatch(
      state.update({
        changes: { from: line.from, to: line.to, insert: "\n" },
        selection: EditorSelection.cursor(line.from + 1),
        userEvent: "input.table",
      })
    );
    return true;
  }
  dispatch(lineUpAndGo(state, table, row === 0 ? 2 : row + 1, col));
  return true;
};

/** Selections touching `[from, to]` (its ends too: a caret just after it). */
const touches = (state: EditorState, from: number, to: number) =>
  state.selection.ranges.some((r) => r.from <= to && r.to >= from);

/** One piece of a cell, as drawn: text, or an element around more pieces. */
type Piece = string | { tag: string; href?: string; children: Piece[] };

/** Inline nodes drawn as elements; their marks (`**`, `` ` ``, `[`) are left out. */
const TAGS: Record<string, string> = {
  StrongEmphasis: "strong",
  Emphasis: "em",
  Strikethrough: "s",
  InlineCode: "code",
  Link: "a",
};
// (a link's url and label come after its text, so the walk never reaches them)
const MARKS = new Set(["EmphasisMark", "CodeMark", "LinkMark", "StrikethroughMark"]);

/** The pieces of `text` from `from` to `to`, read off the syntax tree. */
function pieces(state: EditorState, from: number, to: number): Piece[] {
  const out: Piece[] = [];
  const walk = (node: SyntaxNode | null, into: Piece[], start: number, end: number) => {
    let pos = start;
    for (; node && node.from < end; node = node.nextSibling) {
      if (node.to <= start) continue;
      if (node.from > pos) into.push(state.doc.sliceString(pos, node.from));
      pos = Math.max(pos, node.from);
      const tag = TAGS[node.name];
      if (tag) {
        const children: Piece[] = [];
        const piece: Piece = { tag, children };
        if (node.name === "Link") {
          const url = node.getChild("URL");
          if (url) piece.href = state.doc.sliceString(url.from, url.to);
        }
        // a link's text is its first [...]; the (url) after it isn't drawn
        const marks = node.getChildren("LinkMark");
        const inner = node.name === "Link" && marks.length >= 2 ? marks[1].from : node.to;
        walk(node.firstChild, children, node.from, inner);
        into.push(piece);
      } else if (node.name === "Escape") {
        into.push(state.doc.sliceString(node.from + 1, node.to));
      } else if (!MARKS.has(node.name)) {
        into.push(state.doc.sliceString(node.from, Math.min(node.to, end)));
      }
      pos = Math.min(node.to, end);
    }
    if (pos < end) into.push(state.doc.sliceString(pos, end));
  };
  if (from >= to) return out;
  const tree = syntaxTree(state);
  // the cell's own node, if the parser made one; its children are the inline
  // syntax. A cell the parser split differently is drawn as plain text.
  let cell: SyntaxNode | null = tree.resolveInner(from, 1);
  while (cell && cell.name !== "TableCell" && cell.parent) cell = cell.parent;
  if (cell?.name === "TableCell" && cell.from <= from && cell.to >= to) {
    walk(cell.firstChild, out, from, to);
  } else out.push(state.doc.sliceString(from, to));
  // the walk above treats marks as gaps; drop the empty strings left behind
  return out.filter((p) => p !== "");
}

type Drawn = { align: Align[]; rows: { cells: { at: number; pieces: Piece[] }[] }[] };

function draw(state: EditorState, table: Table): Drawn | null {
  const rows = table.lines.map((l) => lineText(state, l));
  if (rows.length < 2) return null;
  const columns = splitRow(rows[0]).cells.length;
  const align = alignments(rows[1]).slice(0, columns);
  const drawn: Drawn["rows"] = [];
  rows.forEach((text, i) => {
    if (i === 1) return;
    const line = table.lines[i];
    const { cells } = splitRow(text);
    const out = [];
    // a row has as many cells as the header: extras dropped, gaps filled
    for (let col = 0; col < columns; col++) {
      const c = cells[col];
      out.push(
        c
          ? { at: line.from + c.textFrom - table.from, pieces: pieces(state, line.from + c.textFrom, line.from + c.textTo) }
          : { at: line.to - table.from, pieces: [] }
      );
    }
    drawn.push({ cells: out });
  });
  return { align, rows: drawn };
}

function render(pieces: Piece[], into: HTMLElement) {
  for (const p of pieces) {
    if (typeof p === "string") into.append(p);
    else {
      const el = document.createElement(p.tag);
      if (p.tag === "a") {
        el.className = "cm-link";
        if (p.href) {
          el.dataset.href = p.href;
          el.title = p.href;
        }
      }
      if (p.tag === "code") el.className = "cm-md-inline-code";
      render(p.children, el);
      into.append(el);
    }
  }
}

class TableWidget extends WidgetType {
  readonly key: string;
  constructor(readonly table: Drawn) {
    super();
    this.key = JSON.stringify(table);
  }

  eq(other: TableWidget) {
    return other.key === this.key;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table";
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const body = document.createElement("tbody");
    this.table.rows.forEach((row, i) => {
      const tr = document.createElement("tr");
      row.cells.forEach((cell, col) => {
        const td = document.createElement(i === 0 ? "th" : "td");
        const align = this.table.align[col];
        if (align) td.style.textAlign = align;
        td.dataset.at = String(cell.at);
        render(cell.pieces, td);
        tr.append(td);
      });
      (i === 0 ? head : body).append(tr);
    });
    table.append(head);
    if (body.childNodes.length) table.append(body);
    wrap.append(table);

    // a click in a cell edits that cell: the caret goes to the start of its
    // text and the table's source shows. Mod-click on a link opens it, as in
    // the rest of the text (links.ts).
    wrap.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      const link = target.closest<HTMLElement>("a.cm-link");
      if (link?.dataset.href && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        openUrl(link.dataset.href, link);
        return;
      }
      const cell = target.closest<HTMLElement>("th, td");
      event.preventDefault();
      const from = view.posAtDOM(wrap);
      const at = from + (cell ? Number(cell.dataset.at) : 0);
      view.dispatch({ selection: EditorSelection.cursor(at), scrollIntoView: true });
      view.focus();
    });
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

const sourceLine = Decoration.line({ class: "cm-md-table-source" });

function build(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      // top-level tables only: look in the document, not in its blocks
      if (node.name === "Document") return;
      if (node.name !== "Table") return false;
      const table = toTable(state, node);
      const drawn = touches(state, table.from, table.to) ? null : draw(state, table);
      if (drawn) {
        decos.push(
          Decoration.replace({ widget: new TableWidget(drawn), block: true }).range(table.from, table.to)
        );
      } else {
        for (const line of table.lines) decos.push(sourceLine.range(line.from));
      }
      return false;
    },
  });
  return Decoration.set(decos, true);
}

/**
 * A state field, not a view plugin: a decoration that replaces whole lines
 * with a block has to be known before the view lays the lines out.
 */
const tableField = StateField.define<DecorationSet>({
  create: build,
  update(decos, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state))
      return build(tr.state);
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const ink = (fade: number) =>
  `color-mix(in oklab, var(--text-editor-line, currentColor), transparent ${fade}%)`;

const tableTheme = EditorView.baseTheme({
  ".cm-md-table": {
    // a wide table scrolls sideways rather than pushing the page out
    overflowX: "auto",
    paddingBlock: "0.5em",
    cursor: "text",
  },
  ".cm-md-table table": {
    borderCollapse: "collapse",
    fontFamily: "var(--markdown-body-family, inherit)",
    lineHeight: "inherit",
  },
  ".cm-md-table th, .cm-md-table td": {
    border: `1px solid ${ink(82)}`,
    padding: "0.25em 0.75em",
    verticalAlign: "top",
    textAlign: "start",
  },
  ".cm-md-table th": {
    fontWeight: "var(--syntax-weight-strong, bold)",
    background: "var(--text-editor-fill-offset-10, rgb(0 0 0 / 0.04))",
  },
  ".cm-md-table code": {
    fontFamily: "var(--text-editor-family-code)",
  },
  // the source, while it's being edited: in the code font, so the columns
  // that Tab lines up stay lined up
  ".cm-md-table-source": {
    fontFamily: "var(--text-editor-family-code)",
  },
  ".cm-md-table-source *": {
    fontFamily: "inherit",
  },
});

const tableKeys = Prec.high(
  keymap.of([
    { key: "Tab", run: nextCell, shift: previousCell },
    { key: "Enter", run: nextRow },
  ])
);

export const tables = [tableField, tableTheme, tableKeys];
