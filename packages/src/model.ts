// The shapes the views render, and the pure functions that make them. No Solid,
// no DOM: everything here takes plain data and returns plain data.

import { originRank, type Origin } from "./origin.ts";
import type { RegistryEntry } from "./registry.ts";
import type { PkgMeta } from "./pkg-meta.ts";

export type View = "packages" | "registries" | "table";

// A registry *is* a plugin type, so the by-registry view reads as "by type".
export const VIEW_LABEL: Record<View, string> = {
  packages: "By package",
  registries: "By type",
  table: "Table",
};

export type OriginFilter = "all" | Origin;
export type SortKey =
  | "name"
  | "registry"
  | "id"
  | "package"
  | "origin"
  | "unlisted"
  | "inUse";

/** A registry entry plus what we worked out about where it came from. */
export interface Enriched extends RegistryEntry {
  origin: Origin;
  pkgMeta?: PkgMeta;
  pkgName: string;
  /** When it isn't in use: the name of the package whose plugin is. */
  shadowedByName?: string;
  /** When it's in use over others: the names of the packages it shadows. */
  shadowsNames?: string[];
}

export interface PackageGroup {
  importUrl: string | undefined;
  name: string;
  meta?: PkgMeta;
  origin: Origin;
  plugins: Enriched[];
}

export interface TypeGroup {
  registry: string;
  plugins: Enriched[];
}

export function datatypesLabel(
  dt: string | string[] | undefined
): string | null {
  if (dt === undefined) return null;
  if (typeof dt === "string") return dt === "*" ? "any" : dt;
  if (dt.includes("*")) return "any";
  if (dt.length === 0) return "none";
  return dt.join(", ");
}

export function prettyType(type: string): string {
  const [ns, rest] = type.includes(":") ? type.split(/:(.*)/) : ["", type];
  return ns === "patchwork" ? rest : type;
}

/** Keep the entries matching the origin chip and the search text. */
export function filterEntries(
  entries: Enriched[],
  search: string,
  origin: OriginFilter
): Enriched[] {
  const q = search.trim().toLowerCase();
  return entries.filter((e) => {
    if (origin !== "all" && e.origin !== origin) return false;
    if (q) {
      const hay = [
        e.name,
        e.id,
        e.registry,
        e.type,
        e.importUrl,
        e.pkgName,
        datatypesLabel(e.supportedDatatypes),
        e.unlisted ? "unlisted" : "",
        e.inUse ? "" : "shadowed",
        e.shadows?.length ? "overrides" : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** How many of each origin's plugins are in use (shadowed ones aren't counted). */
export function countOrigins(entries: Enriched[]): Record<Origin, number> {
  const counts: Record<Origin, number> = {
    installed: 0,
    ephemeral: 0,
    core: 0,
    unknown: 0,
  };
  for (const e of entries) if (e.inUse) counts[e.origin]++;
  return counts;
}

const byName = (a: Enriched, b: Enriched) => a.name.localeCompare(b.name);

/** One group per importUrl; yours and ephemeral first, then by name. */
export function groupByPackage(entries: Enriched[]): PackageGroup[] {
  const groups = new Map<string, PackageGroup>();
  for (const e of entries) {
    const key = e.importUrl ?? "∅";
    let group = groups.get(key);
    if (!group) {
      group = {
        importUrl: e.importUrl,
        name: e.pkgName,
        meta: e.pkgMeta,
        origin: e.origin,
        plugins: [],
      };
      groups.set(key, group);
    }
    group.plugins.push(e);
  }
  const arr = [...groups.values()];
  for (const g of arr) g.plugins.sort(byName);
  arr.sort(
    (a, b) =>
      originRank(a.origin) - originRank(b.origin) ||
      a.name.localeCompare(b.name)
  );
  return arr;
}

/**
 * One group per registry (plugin type), alphabetical: the plugins in use, one
 * per id. What each shadows is on it (`shadowsNames`).
 */
export function groupByType(entries: Enriched[]): TypeGroup[] {
  const groups = new Map<string, Enriched[]>();
  for (const e of entries) {
    if (!e.inUse) continue;
    const list = groups.get(e.registry);
    if (list) list.push(e);
    else groups.set(e.registry, [e]);
  }
  return [...groups.entries()]
    .map(([registry, plugins]) => ({ registry, plugins: plugins.sort(byName) }))
    .sort((a, b) => a.registry.localeCompare(b.registry));
}

/** The table's rows, sorted by a column then by name. */
export function sortRows(
  entries: Enriched[],
  key: SortKey,
  ascending: boolean
): Enriched[] {
  const dir = ascending ? 1 : -1;
  const value = (e: Enriched): string => {
    switch (key) {
      case "registry":
        return e.registry;
      case "id":
        return e.id;
      case "package":
        return e.pkgName;
      case "origin":
        return String(originRank(e.origin));
      // Ascending groups the unlisted ones first — that's what you sort by
      // this column to find.
      case "unlisted":
        return e.unlisted ? "0" : "1";
      // Likewise the shadowed ones.
      case "inUse":
        return e.inUse ? "1" : "0";
      default:
        return e.name;
    }
  };
  return [...entries].sort(
    (a, b) => value(a).localeCompare(value(b)) * dir || byName(a, b)
  );
}
