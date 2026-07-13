import { createEffect } from "solid-js";

/** CodeMirror */
import { EditorView } from "@codemirror/view";
import { Compartment } from "@codemirror/state";

/** Automerge */
import type { Prop as AutomergeProp } from "@automerge/automerge";
import { automergeSyncPlugin } from "@automerge/automerge-codemirror";
import type { DocHandle } from "@automerge/automerge-repo";

/**
 * Create a CodeMirror extension for synchronizing with an Automerge document using a CodeMirror
 Compartment.
 * @param handle The Automerge document handle.
 * @param path The path to the specific document property to synchronize.
 * @returns A tuple containing the extension and a function to create an effect for reconfiguring the extension when the handle or path change.
 */
export function createSyncExtension<T>(
  handle: () => DocHandle<T>,
  path: () => AutomergeProp[],
  initialDoc: () => string
) {
  const sync = new Compartment();

  const syncExtension = () =>
    handle() && path()
      ? automergeSyncPlugin({
          handle: handle() as any, // typescript is confused by different version of doc handle
          path: path(),
        })
      : [];

  // Reconfiguring the compartment replaces the sync plugin wholesale (the old
  // instance is destroyed without seeing this transaction, so the full-doc
  // reset below is not echoed back into the automerge doc) and the fresh
  // plugin re-seeds its reconciled heads from the current doc.
  const createReconfigureEffect = (view: EditorView) =>
    createEffect(() => {
      // The `handle()`/`path()` reads inside `syncExtension` are tracked, so a
      // reactive prop change re-runs this and rebuilds the plugin.
      view.dispatch({
        effects: sync.reconfigure(syncExtension()),
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: initialDoc(),
        },
      });
    });

  return [sync.of(syncExtension()), createReconfigureEffect] as const;
}
