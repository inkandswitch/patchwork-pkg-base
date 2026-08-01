import { onCleanup, createEffect } from "solid-js";

/** CodeMirror */
import { EditorView } from "@codemirror/view";
import { EditorState, type Extension, Compartment } from "@codemirror/state";

import { theme } from "./extensions";

type TextEditorProps = {
  // The initial document text. Everything after that -- including keeping the
  // editor in step with an automerge doc -- is an extension's job.
  value?: () => string;
  // Reactive: changes are reconfigured into a single compartment, so the editor
  // keeps its state (selection, scroll, undo history) across a change.
  extensions?: () => Extension[];
  // Escape hatch for extensions that drive the editor from outside, e.g. a
  // Solid effect that dispatches a reconfigure when a prop changes.
  withView?(view: EditorView): void;
};

/**
 * A bare CodeMirror instance: text in, extensions in, `view.dom` out. It knows
 * nothing about automerge, patchwork or markdown -- the automerge sync, diff,
 * decoration, read-only and scroll extensions are exported alongside it (see
 * ./extensions) for callers to compose.
 */
export function TextEditor(props: TextEditorProps) {
  const userExtensions = new Compartment();

  const state = EditorState.create({
    doc: props.value?.() ?? "",
    extensions: [
      // First, so a caller's extensions can override it.
      theme,
      userExtensions.of(props.extensions?.() ?? []),
    ],
  });

  const view = new EditorView({ state });

  props.withView?.(view);

  createEffect(() => {
    view.dispatch({
      effects: userExtensions.reconfigure(props.extensions?.() ?? []),
    });
  });

  onCleanup(() => view.destroy());

  return view.dom;
}
