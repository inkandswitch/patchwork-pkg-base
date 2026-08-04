import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  lineNumbers,
  highlightSpecialChars,
  highlightActiveLineGutter,
  highlightActiveLine,
  rectangularSelection,
  keymap,
} from "@codemirror/view";
import {
  indentUnit,
  bracketMatching,
  foldGutter,
  foldKeymap,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  emacsStyleKeymap,
} from "@codemirror/commands";

const mod = {
  shift: 1,
  control: 2,
  option: 3,
  command: 4,
} as const;

function modshift(event: {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}) {
  let bits = 0;
  bits |= +event.shiftKey << mod.shift;
  bits |= +event.ctrlKey << mod.control;
  bits |= +event.altKey << mod.option;
  bits |= +event.metaKey << mod.command;
  return bits;
}

// The code-editing affordances: gutters, folding, search, undo, keymaps. No
// language in here -- pair it with a language extension for highlighting.
export function code(): Extension {
  return [
    lineNumbers(),
    highlightSpecialChars(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    history(),
    foldGutter(),
    bracketMatching(),
    indentUnit.of("\t"),
    EditorState.allowMultipleSelections.of(true),
    EditorState.tabSize.of(2),
    EditorView.lineWrapping,
    EditorView.clickAddsSelectionRange.of(
      (event) => modshift(event) === 1 << mod.option
    ),
    rectangularSelection({
      eventFilter: (event) =>
        modshift(event) === ((1 << mod.shift) | (1 << mod.option)),
    }),
    keymap.of([
      indentWithTab,
      ...emacsStyleKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...defaultKeymap,
    ]),
  ];
}
