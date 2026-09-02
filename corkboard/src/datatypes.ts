// Live lookups against the `patchwork:datatype` plugin registry, shared by the
// two llm:skills in this package: the generic one that tells the computer which
// datatypes exist, and the corkboard one that creates a document of a chosen
// datatype as a canvas embed.

import {
  getRegistry,
  type DatatypeDescription,
  type LoadedDatatype,
} from "@inkandswitch/patchwork-plugins";

export type DatatypeInfo = { id: string; name: string };

/** Every datatype a user could sensibly create, id + name, sorted by name.
 * `unlisted` datatypes (e.g. `file`, and the embed frame's own helpers) are
 * omitted for the same reason the create-new menus omit them: they exist to be
 * produced by something else, not conjured empty. */
export function listDatatypes(): DatatypeInfo[] {
  let plugins: { id: string; name?: string; unlisted?: boolean }[] = [];
  try {
    plugins = getRegistry<DatatypeDescription>("patchwork:datatype").all();
  } catch {
    return [];
  }
  return plugins
    .filter((p) => p && typeof p.id === "string" && !p.unlisted)
    .map((p) => ({ id: p.id, name: p.name || p.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Load one datatype's implementation by id, or undefined if it isn't
 * installed. Loading is what gives us `init` (for createDocOfDatatype2) and
 * `getTitle`. */
export async function loadDatatype(
  id: string
): Promise<LoadedDatatype | undefined> {
  try {
    const loaded = await getRegistry<DatatypeDescription>(
      "patchwork:datatype"
    ).load(id);
    return loaded as LoadedDatatype | undefined;
  } catch {
    return undefined;
  }
}

/** The installed ids as a one-line hint, for the "no such datatype" errors the
 * model reads. */
export function datatypeIdsHint(): string {
  const ids = listDatatypes().map((d) => d.id);
  return ids.length ? ids.join(", ") : "(none registered)";
}
