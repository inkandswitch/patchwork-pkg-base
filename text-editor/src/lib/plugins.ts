// Which CodeMirror extensions an editor turns on is a property of the DOCUMENT,
// not of its datatype: `doc.plugins` is an array of `codemirror:extension` ids.
// A datatype seeds that array at creation (see the `markdown` preset), and it's
// editable afterwards, so two docs of the same type can run different editors.
//
// Documents created before `plugins` existed have no array. Those fall back to
// the old behaviour — filter the registry by the doc's `@patchwork` type against
// each extension's `supportedDatatypes`.

import type { Extension } from "@codemirror/state";
import type { Prop as AutomergeProp } from "@automerge/automerge/slim";
import type { DocHandle } from "@automerge/automerge-repo/slim";
import { getRegistry } from "@inkandswitch/patchwork-plugins";

export type PluginDoc = {
  plugins?: string[];
  "@patchwork"?: { type?: string };
};

/**
 * What an extension is allowed to know about the document it's editing.
 *
 * Most extensions are a plain `Extension` value and need none of this. Ones
 * that do -- a TypeScript environment has to know whether it's parsing .ts or
 * .tsx, and needs the text to seed itself -- export a factory from `load()`
 * instead, and get this passed in.
 *
 * A factory rather than a CodeMirror facet because a facet is an IDENTITY: an
 * extension bundled separately from the editor would define its own facet
 * object and read nothing. This is a plain object, so it crosses bundles. The
 * context is also fixed for an editor's lifetime, so none of what a facet buys
 * (reconfiguration, multiple providers) is wanted here.
 */
export type DocumentContext = {
  handle: DocHandle<unknown>;
  path: AutomergeProp[];
  // Present when the document has a filename -- a `file` doc does, a `text`
  // doc doesn't. Extensions that need it should degrade when it's absent.
  name?: string;
  mimeType?: string;
};

export type ExtensionModule =
  | Extension
  | Extension[]
  | ((context: DocumentContext) => Extension | Extension[]);

export function pluginIds(doc: PluginDoc | undefined): string[] | null {
  return Array.isArray(doc?.plugins) ? doc.plugins : null;
}

export function docType(doc: PluginDoc | undefined): string | undefined {
  return doc?.["@patchwork"]?.type;
}

export async function loadExtensions(
  ids: string[] | null,
  type: string | undefined,
  context: DocumentContext
): Promise<Extension[]> {
  const registry = getRegistry<any>("codemirror:extension");
  const wanted = registry.filter((ext) =>
    ids ? ids.includes(ext.id) : supportsDatatype(ext, type)
  );
  const loaded = await registry.loadAll(wanted);
  return loaded.flatMap((ext) => {
    const module = ext.module as ExtensionModule;
    const impl = typeof module === "function" ? module(context) : module;
    return Array.isArray(impl) ? impl : [impl];
  });
}

function supportsDatatype(ext: any, type: string | undefined): boolean {
  if (ext.supportedDatatypes === "*") return true;
  return (
    Array.isArray(ext.supportedDatatypes) &&
    ext.supportedDatatypes.includes(type)
  );
}
