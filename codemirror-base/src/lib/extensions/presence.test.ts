import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createRoot, createSignal } from "solid-js";
import { createPresenceExtension } from "./presence";

// Just enough of a DocHandle for Presence: it listens for and sends
// ephemeral messages, and the doc is a single text field.
function fakeHandle() {
  return {
    url: "automerge:2iRo1dUYYi4RGGCbJ6Hr4uD9AKbQ",
    doc: () => ({ text: "hello" }),
    on() {},
    off() {},
    broadcast() {},
  } as any;
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("presence", () => {
  it("survives being reconfigured while a caret-layer measure is queued", async () => {
    // CodeMirror reports errors thrown while drawing to its exception sink.
    const errors: unknown[] = [];

    const handle = fakeHandle();
    const [url, setUrl] = createSignal<any>("automerge:contact-a");
    const dispose = createRoot((dispose) => {
      const [extension, reconfigure] = createPresenceExtension(
        () => handle,
        () => ["text"],
        url,
        { find: () => new Promise(() => {}) } as any
      );
      const view = new EditorView({
        parent: document.body,
        state: EditorState.create({
          doc: "hello",
          extensions: [
            extension,
            EditorView.exceptionSink.of((e) => errors.push(e)),
          ],
        }),
      });
      reconfigure(view);
      // a new identity rebuilds presence before the first layer measure runs
      setUrl("automerge:contact-b");
      return () => {
        view.destroy();
        dispose();
      };
    });

    await frame();
    await frame();
    dispose();
    expect(errors).toEqual([]);
  });
});
