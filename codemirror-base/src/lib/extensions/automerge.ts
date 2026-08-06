import { createEffect } from "solid-js";

/** CodeMirror */
import { EditorView } from "@codemirror/view";
import { Compartment, Transaction } from "@codemirror/state";

/** Automerge */
import type { Prop as AutomergeProp } from "@automerge/automerge/slim";
import type { DocHandle } from "@automerge/automerge-repo/slim";
import { automergePlugin } from "../../vendor/automerge-codemirror/index.js";

/**
 * Install the vendored automerge plugin — two-way sync plus the undo history
 * and read-only tracking entangled with it — behind a Compartment so it can
 * be swapped out when the reactive `handle`/`path` props change.
 *
 * In-place backing swaps (a `change` event with `scopeReplaced: true`, e.g.
 * scrubbing history or switching drafts re-pointing the handle at a
 * different clone) need no handling here: the vendored plugin diffs through
 * them itself — preserving the selection when the backings share history —
 * its bundled history resets, and its read-only tracking re-reads the
 * handle. The compartment only exists for *identity* changes: a different
 * handle object or path, which the plugin bound at construction cannot
 * follow.
 *
 * @param handle The Automerge document handle.
 * @param path The path to the specific document property to synchronize.
 * @param initialDoc The text at `path`, read fresh on each rebuild.
 * @returns A tuple containing the extension and a function to create an
 * effect for reconfiguring the extension when the handle or path change.
 */
export function createAutomergeExtension<T>(
  handle: () => DocHandle<T>,
  path: () => AutomergeProp[],
  initialDoc: () => string
) {
  const compartment = new Compartment();

  const extension = () =>
    handle() && path()
      ? automergePlugin({
          handle: handle() as any, // typescript is confused by different version of doc handle
          path: path(),
        })
      : [];

  // Reconfiguring replaces the plugin wholesale (the old instance is
  // destroyed without seeing this transaction, so the full-doc reset below
  // is not echoed back into the automerge doc) and the fresh plugin
  // re-seeds its reconciled heads from the current doc. The reset is a
  // synthetic remote transaction, not a user edit: it must not land on the
  // undo stack (undoing it would restore a different document's text and
  // write it back into the doc).
  const createReconfigureEffect = (view: EditorView) =>
    createEffect(() => {
      // The `handle()`/`path()` reads inside `extension()` and the
      // `initialDoc()` read are tracked, so a reactive prop change re-runs
      // this whole rebuild.
      view.dispatch({
        effects: compartment.reconfigure(extension()),
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: initialDoc(),
        },
        annotations: [
          Transaction.addToHistory.of(false),
          Transaction.remote.of(true),
        ],
      });
    });

  return [compartment.of(extension()), createReconfigureEffect] as const;
}
