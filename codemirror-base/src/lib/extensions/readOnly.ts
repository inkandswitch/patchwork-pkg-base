import { createEffect, createSignal, onCleanup } from "solid-js";

/** CodeMirror */
import { EditorView } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";

/** Automerge */
import type {
  DocHandle,
  DocHandleChangePayload,
} from "@automerge/automerge-repo/slim";

/**
 * Create a CodeMirror extension that makes the editor read-only whenever the
 * handle is (`handle.isReadOnly()`, e.g. a heads-pinned view) or the `force`
 * override says so.
 *
 * The handle's read-only state can flip in place: its backing may be swapped
 * without the handle identity changing (a `change` event with
 * `scopeReplaced: true`), so it is tracked as a signal re-read on every swap
 * rather than sampled once.
 *
 * @param handle The Automerge document handle.
 * @param force Forces read-only regardless of the handle's state.
 * @returns A tuple containing the extension and a function to create the
 * effects that track the handle and reconfigure the extension.
 */
export function createReadOnlyExtension<T>(
  handle: () => DocHandle<T> | undefined,
  force: () => boolean = () => false
) {
  const readOnlyCompartment = new Compartment();

  // Seeded at factory time so the initial EditorState is already correct when
  // the editor mounts on a read-only handle.
  const [handleReadOnly, setHandleReadOnly] = createSignal(
    !!handle()?.isReadOnly()
  );

  const readOnlyExtensions = () =>
    force() || handleReadOnly()
      ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
      : [];

  const createReconfigureEffect = (view: EditorView) => {
    // Follow the handle's read-only state across backing swaps.
    createEffect(() => {
      const h = handle();
      if (!h) return;
      setHandleReadOnly(h.isReadOnly());
      const onChange = (payload: DocHandleChangePayload<T>) => {
        if (payload.scopeReplaced) setHandleReadOnly(h.isReadOnly());
      };
      h.on("change", onChange);
      onCleanup(() => h.off("change", onChange));
    });

    createEffect(() => {
      view.dispatch({
        effects: readOnlyCompartment.reconfigure(readOnlyExtensions()),
      });
    });
  };

  return [
    readOnlyCompartment.of(readOnlyExtensions()),
    createReconfigureEffect,
  ] as const;
}
