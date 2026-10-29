// Docs that aren't folders but have children: a directory doc's files (a
// pushwork package), a branches doc's branches, and any type a package
// registers a path provider for. Which children they have is the host's call
// (patchwork-filesystem's built-in providers, then patchwork-plugins'
// path-provider plugins; both importmap externals), the same providers a path
// walks, so a child opens at a path the router can resolve. Each is
// feature-detected: an older host shows these docs as plain rows, as before.
import * as filesystem from "@inkandswitch/patchwork-filesystem";
import * as plugins from "@inkandswitch/patchwork-plugins";
import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo/slim";
import { createSignal, onCleanup } from "solid-js";

type Segment = string | number;
type Child = {
  name: string;
  link?: AutomergeUrl;
  value?: unknown;
  union?: AutomergeUrl[];
  sub?: Segment[];
};

/** A path provider, as much of one as the sidebar uses. The editing methods are optional. */
export type Provider = {
  list(node: unknown): Child[];
  add?(
    handle: DocHandle<unknown>,
    node: unknown,
    child: { name: string; link: AutomergeUrl },
    index?: number
  ): void | Promise<void>;
  rename?(handle: DocHandle<unknown>, node: unknown, name: string, to: string): void | Promise<void>;
  remove?(handle: DocHandle<unknown>, node: unknown, name: string): void | Promise<void>;
};

/** What this needs of the host's patchwork-filesystem and patchwork-plugins; all optional. */
export type HostPaths = {
  providerFor?(doc: unknown): Provider | undefined;
  pathProviderFor?(doc: unknown): Promise<Provider | undefined>;
  pathProviderTypes?(): Set<string>;
  getRegistry?(type: string): { on?(event: "changed", listener: () => void): () => void };
};

const fromHost = (module: object, names: (keyof HostPaths)[]): HostPaths =>
  Object.fromEntries(
    names.flatMap((name) => {
      const value = (module as Record<string, unknown>)[name];
      return typeof value === "function" ? [[name, value]] : [];
    })
  );

const hostPaths: HostPaths = {
  ...fromHost(filesystem, ["providerFor"]),
  ...fromHost(plugins, ["pathProviderFor", "pathProviderTypes", "getRegistry"]),
};

// Types whose rows expand through a built-in provider. Folders have their own
// row (folder.tsx), which can also be edited.
const EXPANDABLE = new Set(["directory", "branches"]);

/** Whether a link of `type` can be opened up to show its children, as things stand. */
export function canExpand(type: string, host: HostPaths = hostPaths): boolean {
  if (EXPANDABLE.has(type) && host.providerFor) return true;
  return !!host.pathProviderFor && !!host.pathProviderTypes?.().has(type);
}

/** A signal that changes whenever path-provider plugins are registered or removed. */
export function useProviderVersion(host: HostPaths = hostPaths): () => number {
  const [version, setVersion] = createSignal(0);
  const off = host.getRegistry?.("patchwork:path-provider").on?.("changed", () =>
    setVersion((n) => n + 1)
  );
  if (typeof off === "function") onCleanup(off);
  return version;
}

/**
 * {@link canExpand}, following path-provider plugins as they register, so a
 * row of a package's type opens up once its package has loaded.
 */
export function useExpandable(host: HostPaths = hostPaths): (type: string) => boolean {
  const version = useProviderVersion(host);
  return (type) => {
    version();
    return canExpand(type, host);
  };
}

/** The provider that walks `doc`: plugins' if the host has them, else the built-ins. */
export async function providerOf(
  doc: unknown,
  host: HostPaths = hostPaths
): Promise<Provider | undefined> {
  try {
    if (host.pathProviderFor) return await host.pathProviderFor(doc);
    return host.providerFor?.(doc);
  } catch {
    return undefined;
  }
}

/** The value at `segments` below `doc`, or undefined: as a walk finds it. */
export function valueAt(doc: unknown, segments: Segment[]): unknown {
  let at = doc;
  for (const segment of segments) {
    if (!at || typeof at !== "object" || at instanceof Uint8Array) return undefined;
    if (!Object.hasOwn(at, segment)) return undefined;
    at = (at as Record<Segment, unknown>)[segment];
  }
  return at;
}

export type ContainerChild =
  | { name: string; url: AutomergeUrl }
  | { name: string; sub: Segment[] };

/**
 * The documents `doc` links to, and the values it offers as sub-documents, by
 * name. Other values inside it aren't documents, and stay hidden.
 */
export function containerChildren(
  doc: unknown,
  provider: Provider | undefined
): ContainerChild[] {
  let children: Child[];
  try {
    children = provider?.list(doc) ?? [];
  } catch {
    return [];
  }
  return children.flatMap((child): ContainerChild[] =>
    child.link
      ? [{ name: child.name, url: child.link }]
      : Array.isArray(child.sub) && valueAt(doc, child.sub) !== undefined
        ? [{ name: child.name, sub: child.sub }]
        : []
  );
}

/**
 * The same object for a child that hasn't changed, list after list, so a
 * `<For>` keeps its row (and anything open under it) mounted across edits to
 * the container.
 */
export function stableChildren(): (children: ContainerChild[]) => ContainerChild[] {
  let previous = new Map<string, ContainerChild>();
  return (children) => {
    const next = new Map<string, ContainerChild>();
    const out = children.map((child) => {
      const key = JSON.stringify(child);
      const kept = previous.get(key) ?? next.get(key) ?? child;
      next.set(key, kept);
      return kept;
    });
    previous = next;
    return out;
  };
}
