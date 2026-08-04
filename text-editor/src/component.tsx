// The embeddable text editor: `<patchwork-view component="text-editor">`.
//
// Deliberately smaller than the tool. It binds the bare editor to a document's
// text and loads that document's `@text-editor.plugins`, and that's all -- comments, diffs
// and cross-view focus are studio features and live in the tool. This is what
// another tool embeds when it just wants an editor.
//
//   <patchwork-view component="text-editor" doc-url="automerge:…"></patchwork-view>
//   <patchwork-view component="text-editor" path="content" plugins="codemirror-markdown">
//
// `path` is dot-separated and defaults to "content". `plugins` overrides the
// document's own array (comma-separated ids, or empty for a bare editor).

import { render } from "solid-js/web";
import { createResource, createSignal, onCleanup, Show } from "solid-js";
import { subscribe } from "@inkandswitch/patchwork-providers-solid";
import type { Extension } from "@codemirror/state";
import type { Prop as AutomergeProp } from "@automerge/automerge/slim";
import type { DocHandle, Repo } from "@automerge/automerge-repo/slim";

import { TextEditor } from "./lib/codemirror.tsx";
import {
  commands,
  pluginPanel,
  createSyncExtension,
  createReadOnlyExtension,
} from "./lib/extensions/index.ts";
import {
  loadExtensions,
  pluginIds,
  docType,
  type PluginDoc,
} from "./lib/plugins.ts";
import { READ_ONLY } from "./lib/read-only.ts";

type Fileish = { name?: string; mimeType?: string } | undefined;

function BoundEditor(props: {
  element: HTMLElement;
  handle: DocHandle<unknown>;
  path: AutomergeProp[];
  override: string[] | null;
  name?: string;
  mimeType?: string;
}) {
  // The handle's own answer, OR whatever the host says. See lib/read-only.ts.
  const provided = subscribe<boolean>(props.element, { type: READ_ONLY }, false);
  const isReadOnly = () => props.handle.isReadOnly() || provided();

  // A plain string is collaboratively editable; an ImmutableString (or anything
  // else) is text we can render but not splice into, so it gets no sync plugin.
  const content = () => lookup(props.handle.doc(), props.path);
  const isSyncable = () => typeof content() === "string";
  const initialDoc = () => content()?.toString() ?? "";

  const selection = () => {
    const doc = props.handle.doc() as PluginDoc | undefined;
    return { ids: props.override ?? pluginIds(doc), type: docType(doc) };
  };
  const [pluginSelection, setPluginSelection] = createSignal(selection(), {
    equals: (a, b) => a.type === b.type && String(a.ids) === String(b.ids),
  });
  const onDocChange = () => setPluginSelection(selection());
  props.handle.on("change", onDocChange);
  onCleanup(() => props.handle.off("change", onDocChange));

  const [pluginExtensions] = createResource(pluginSelection, (s) =>
    loadExtensions(s.ids, s.type, {
      handle: props.handle,
      path: props.path,
      // A `file` doc carries its own name and mime type; the attributes are
      // there for hosts whose documents don't.
      name: props.name ?? (props.handle.doc() as Fileish)?.name,
      mimeType: props.mimeType ?? (props.handle.doc() as Fileish)?.mimeType,
    })
  );

  const [syncExtension, reconfigureSync] = createSyncExtension(
    () => props.handle,
    () => props.path,
    initialDoc
  );
  const [readOnlyExtension, reconfigureReadOnly] =
    createReadOnlyExtension(isReadOnly);

  const extensions = (): Extension[] => [
    commands(props.handle, props.path, {
      pluginsEditable: props.override === null,
    }),
    ...(props.override === null ? [pluginPanel(props.handle)] : []),
    ...(isSyncable() ? [syncExtension] : []),
    ...(pluginExtensions.latest ?? []),
    readOnlyExtension,
  ];

  return (
    <Show when={pluginExtensions.latest !== undefined}>
      <TextEditor
        value={initialDoc}
        extensions={extensions}
        withView={(view) => {
          if (isSyncable()) reconfigureSync(view);
          reconfigureReadOnly(view);
        }}
      />
    </Show>
  );
}

/** patchwork:component render: `(element) => cleanup`. */
export function TextEditorComponent(element: HTMLElement) {
  const repo: Repo = (element as any).repo ?? (window as any).repo;
  const url = element.getAttribute("doc-url") ?? (element as any).docUrl;
  const path = (element.getAttribute("path") ?? "content").split(".");
  const pluginsAttr = element.getAttribute("plugins");
  const override =
    pluginsAttr === null
      ? null
      : pluginsAttr
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

  let dispose: (() => void) | null = null;
  let disposed = false;

  (async () => {
    if (!repo || !url) return;
    try {
      const handle = await repo.find(url.split("#")[0]);
      if (disposed) return;
      dispose = render(
        () => (
          <BoundEditor
            element={element}
            handle={handle}
            path={path}
            override={override}
            name={element.getAttribute("name") ?? undefined}
            mimeType={element.getAttribute("mime-type") ?? undefined}
          />
        ),
        element
      );
    } catch (e) {
      console.warn("[text-editor] component find:", e);
    }
  })();

  return () => {
    disposed = true;
    dispose?.();
  };
}

function lookup(doc: unknown, path: AutomergeProp[]): unknown {
  let current: unknown = doc;
  for (const key of path) {
    if (current == null) return undefined;
    current = (current as Record<AutomergeProp, unknown>)[key];
  }
  return current;
}
