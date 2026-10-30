import type {
  ToolDescription,
  DatatypeDescription,
  Plugin,
} from "@inkandswitch/patchwork-plugins";
import {
  getRegistry,
  getSupportedToolsForType,
} from "@inkandswitch/patchwork-plugins";
import {
  type Accessor,
  createEffect,
  createRoot,
  createSignal,
  onCleanup,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";

export type MaybeAccessor<T> = T | (() => T);

// a broken plugin may register without a name; show its id rather than
// letting it take the whole menu down
export const label = (d: Plugin<DatatypeDescription>) =>
  typeof d.name === "string" ? d.name : String(d.id);

let listed: Accessor<Plugin<DatatypeDescription>[]> | undefined;

/**
 * The listed (not `unlisted`) datatypes, sorted by name. One signal for the
 * page, made on first call and kept current from the registry from then on,
 * so a create menu opens with its list already in hand.
 */
export function listedDatatypes(): Accessor<Plugin<DatatypeDescription>[]> {
  if (!listed) {
    const registry = getRegistry<DatatypeDescription>("patchwork:datatype");
    const read = () =>
      registry
        .filter((d) => !d.unlisted)
        .sort((a, b) => label(a).localeCompare(label(b)));
    const [get, set] = createSignal(read());
    registry.on("changed", () => set(read()));
    listed = get;
  }
  return listed;
}

/**
 * Create a ref-counted shared reactive resource keyed by a string.
 * The factory runs once per unique key (inside its own reactive root).
 * When the last consumer unmounts, the root is disposed and the
 * entry is removed from the cache.
 */
function createShared<V>(factory: (key: string) => V): (key: string) => V {
  const cache = new Map<
    string,
    { value: V; refCount: number; dispose: () => void }
  >();

  return (key: string) => {
    if (!cache.has(key)) {
      let dispose!: () => void;
      const value = createRoot((d) => {
        dispose = d;
        return factory(key);
      });
      cache.set(key, { value, refCount: 0, dispose });
    }

    const entry = cache.get(key)!;
    entry.refCount++;
    onCleanup(() => {
      entry.refCount--;
      if (entry.refCount === 0) {
        entry.dispose();
        cache.delete(key);
      }
    });

    return entry.value;
  };
}

const useSharedToolsForType = createShared((type) => {
  const toolRegistry = getRegistry<ToolDescription>("patchwork:tool");
  const [plugins, setPlugins] = createStore<Plugin<ToolDescription>[]>([]);

  const update = () => {
    const tools = getSupportedToolsForType(type);
    setPlugins(reconcile(tools));
  };
  update();

  const dispose = toolRegistry.on("changed", update);
  onCleanup(dispose);

  return plugins;
});

/**
 * Hook to get tools that support a specific data type.
 * Shared across all callers for the same type — only one
 * store/listener exists per unique type string.
 */
export function useSupportedToolsForType(
  type: MaybeAccessor<string>,
  options?: { includeUnlisted?: boolean }
): Plugin<ToolDescription>[] {
  const key = typeof type === "function" ? type() : type;
  const all = useSharedToolsForType(key);
  if (options?.includeUnlisted) return all;
  const [filtered, setFiltered] = createStore<Plugin<ToolDescription>[]>([]);
  createEffect(() => {
    setFiltered(reconcile(all.filter((t) => !t.unlisted)));
  });
  return filtered;
}
