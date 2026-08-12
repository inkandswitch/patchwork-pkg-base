import type { StateCommand } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";
import type { KeyBinding } from "@codemirror/view";

const toggleWrap =
  (mark: string): StateCommand =>
  ({ state, dispatch }) => {
    const selection = state.changeByRange((range) => {
      const before = state.sliceDoc(range.from - mark.length, range.from);
      const after = state.sliceDoc(range.to, range.to + mark.length);
      const inside =
        state.sliceDoc(range.from, range.from + mark.length) === mark &&
        state.sliceDoc(range.to - mark.length, range.to) === mark &&
        range.to - range.from >= mark.length * 2;

      if (before === mark && after === mark) {
        return {
          changes: [
            { from: range.from - mark.length, to: range.from },
            { from: range.to, to: range.to + mark.length },
          ],
          range: EditorSelection.range(
            range.from - mark.length,
            range.to - mark.length
          ),
        };
      }

      if (inside) {
        return {
          changes: [
            { from: range.from, to: range.from + mark.length },
            { from: range.to - mark.length, to: range.to },
          ],
          range: EditorSelection.range(
            range.from,
            range.to - mark.length * 2
          ),
        };
      }

      return {
        changes: [
          { from: range.from, insert: mark },
          { from: range.to, insert: mark },
        ],
        range: EditorSelection.range(
          range.from + mark.length,
          range.to + mark.length
        ),
      };
    });

    dispatch(state.update(selection, { scrollIntoView: true, userEvent: "input" }));
    return true;
  };

export const toggleBold = toggleWrap("**");
export const toggleItalic = toggleWrap("_");
export const toggleStrikethrough = toggleWrap("~~");
export const toggleCode = toggleWrap("`");

export const markdownFormattingKeymap: KeyBinding[] = [
  { key: "Mod-b", run: toggleBold, preventDefault: true },
  { key: "Mod-i", run: toggleItalic, preventDefault: true },
  { key: "Mod-Shift-x", run: toggleStrikethrough, preventDefault: true },
  { key: "Mod-e", run: toggleCode, preventDefault: true },
];
