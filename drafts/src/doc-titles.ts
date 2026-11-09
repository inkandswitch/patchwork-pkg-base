import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo/slim";
import {
  getRegistry,
  isLoadedPlugin,
  type DatatypeDescription,
  type DatatypeImplementation,
} from "@inkandswitch/patchwork-plugins";

const REFRESH_DEBOUNCE_MS = 250;

type TitledDoc = { url: AutomergeUrl; handle: DocHandle<unknown> };

// Each doc's title, as its datatype names it. `onChange` gets every title
// again whenever one changes: on edits, and when a datatype finishes loading.
export function watchDocTitles(
  docs: TitledDoc[],
  onChange: (titles: Map<AutomergeUrl, string>) => void
): () => void {
  const registry = getRegistry<DatatypeDescription>("patchwork:datatype");
  let current = new Map<AutomergeUrl, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const refresh = () => {
    timer = undefined;
    const next = new Map<AutomergeUrl, string>();
    for (const { url, handle } of docs) {
      const title = titleOf(registry, handle.doc());
      if (title) next.set(url, title);
    }
    if (sameTitles(current, next)) return;
    current = next;
    onChange(next);
  };
  const schedule = () => {
    timer ??= setTimeout(refresh, REFRESH_DEBOUNCE_MS);
  };

  for (const { handle } of docs) handle.on("change", schedule);
  const offLoaded = registry.on("loaded", schedule);
  const offChanged = registry.on("changed", schedule);
  refresh();

  return () => {
    clearTimeout(timer);
    for (const { handle } of docs) handle.off("change", schedule);
    offLoaded();
    offChanged();
  };
}

type Metadata = { "@patchwork"?: { type?: string; title?: string }; title?: unknown };

function titleOf(
  registry: ReturnType<typeof getRegistry<DatatypeDescription>>,
  doc: unknown
): string | undefined {
  if (!doc || typeof doc !== "object") return undefined;
  const meta = doc as Metadata;
  const type = meta["@patchwork"]?.type;
  const datatype = type ? registry.get(type) : undefined;
  if (datatype && isLoadedPlugin(datatype)) {
    try {
      const title = (datatype.module as DatatypeImplementation).getTitle(doc);
      if (title) return title;
    } catch {
      // a datatype that can't title this doc falls back to its metadata
    }
  } else if (type) {
    void registry.load(type);
  }
  return meta["@patchwork"]?.title ?? (typeof meta.title === "string" ? meta.title : undefined);
}

function sameTitles(a: Map<AutomergeUrl, string>, b: Map<AutomergeUrl, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [url, title] of a) if (b.get(url) !== title) return false;
  return true;
}
