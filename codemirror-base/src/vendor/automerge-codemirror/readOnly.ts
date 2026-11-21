import {
  Compartment,
  EditorState,
  Transaction,
  type Extension,
} from "@codemirror/state"
import { EditorView, ViewPlugin } from "@codemirror/view"
import type { DocHandle, DocHandleChangePayload } from "./DocHandle.js"
import { isReconcileTx } from "./plugin.js"

/**
 * What read-only means here. Not `editable(false)`: that makes the content
 * unfocusable, and with it go the caret, keyboard selection, search and
 * font zoom. Instead:
 *
 * - `readOnly` makes CodeMirror drop DOM edits and built-in commands refuse.
 * - A filter drops any other doc change — a custom command or plugin that
 *   doesn't check `readOnly` — unless it's syncing the doc in from outside
 *   (a reconcile, or annotated `Transaction.remote`).
 * - `inputmode=none` keeps a tap from raising a phone's keyboard.
 */
export const readOnlyExtensions: Extension = [
  EditorState.readOnly.of(true),
  EditorState.transactionFilter.of(tr =>
    !tr.docChanged || isReconcileTx(tr) || tr.annotation(Transaction.remote)
      ? tr
      : []
  ),
  EditorView.contentAttributes.of({ inputmode: "none" }),
]

type AutomergeReadOnlyConfig = {
  handle: DocHandle<unknown>
}

/**
 * Makes the editor read-only while the handle rejects writes
 * (`handle.isReadOnly()`, e.g. pinned to historical heads). This is a
 * correctness requirement of syncing, not a preference: an editable editor
 * bound to a read-only handle produces edits the write-back must drop.
 *
 * Tracked live: the flag can flip in place when the handle's backing is
 * swapped (a `change` event with `scopeReplaced: true`). Handles without
 * `isReadOnly` are treated as always writable.
 */
export const automergeReadOnly = ({
  handle,
}: AutomergeReadOnlyConfig): Extension => {
  const compartment = new Compartment()
  const isReadOnly = () => !!handle.isReadOnly?.()
  const extensions = () => (isReadOnly() ? readOnlyExtensions : [])

  const trackPlugin = ViewPlugin.fromClass(
    class {
      wasPrevReadOnly = isReadOnly()
      destroyed = false
      readonly view: EditorView

      constructor(view: EditorView) {
        this.view = view
        this.onChange = this.onChange.bind(this)
        handle.on("change", this.onChange)
        // The flag may have flipped between extension creation and mount;
        // deferred because dispatching isn't allowed while the view is
        // still initializing.
        queueMicrotask(() => {
          if (!this.destroyed) this.sync()
        })
      }

      onChange(payload?: DocHandleChangePayload) {
        if (payload?.scopeReplaced) this.sync()
      }

      sync() {
        const current = isReadOnly()
        if (current === this.wasPrevReadOnly) return
        this.wasPrevReadOnly = current
        this.view.dispatch({ effects: compartment.reconfigure(extensions()) })
      }

      destroy() {
        this.destroyed = true
        handle.off("change", this.onChange)
      }
    }
  )

  return [compartment.of(extensions()), trackPlugin]
}
