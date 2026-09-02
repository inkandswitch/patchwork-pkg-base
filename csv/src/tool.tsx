import "./styles.css";
import type {
  AutomergeUrl,
  DocHandle,
  Repo,
} from "@automerge/automerge-repo/slim";
import type { ToolImplementation } from "@inkandswitch/patchwork-plugins";
import { subscribe } from "@inkandswitch/patchwork-providers";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { render } from "solid-js/web";
import { parseCsv, sniffDelimiter, type CsvCell } from "./parse-csv";

// A read-only CSV table view for `file` documents, with provenance:
//
//   - subscribes to `patchwork:provenance` for the file and marks every cell
//     that overlaps a source range (text another document was generated from);
//   - draws the stronger tint when the shared focus selection/highlight
//     lands on a source range or one of its targets (e.g. an element selected
//     on a Petrinaut canvas);
//   - clicking a cell pushes the overlapping source refs and their linked
//     targets into the shared focus selection, so views of the generated doc
//     highlight what came from that cell.
//
// The offsets that make this work come from the offset-tracking parser in
// `parse-csv.ts`: cursor-anchored provenance refs address character ranges of
// the file's `content` string, and every cell knows the range it occupies.
// Outside a provenance provider the subscription is never answered and the
// tool is just a CSV viewer.

type FileDoc = {
  name?: string;
  extension?: string;
  mimeType?: string;
  content?: unknown;
};

type FocusDoc = {
  selection: Record<AutomergeUrl, true>;
  highlight: Record<AutomergeUrl, true>;
};

// Mirrors the corkboard's ProvenanceLink structurally (the packages are
// standalone, so the type is not imported).
type ProvenanceLink = {
  sourceUrl: AutomergeUrl;
  targetUrl: AutomergeUrl;
  entryUrl: AutomergeUrl;
};

// A provenance source range in this file, resolved to a live ref handle,
// with the target refs (in other docs) it links to.
type ProvenanceSource = {
  handle: DocHandle<unknown>;
  targetUrls: AutomergeUrl[];
};

// A source range materialized to plain offsets for the current doc state.
type SourceSpan = {
  start: number;
  end: number;
  sourceUrl: AutomergeUrl;
  targetUrls: AutomergeUrl[];
  emphasised: boolean;
};

const mount: ToolImplementation = (handle, element) => {
  const repo = (element as HTMLElement & { repo?: Repo }).repo;
  return render(
    () => (
      <CsvTool
        handle={handle as DocHandle<FileDoc>}
        element={element}
        repo={repo}
      />
    ),
    element,
  );
};

export default mount;

function CsvTool(props: {
  handle: DocHandle<FileDoc>;
  element: HTMLElement;
  repo: Repo | undefined;
}) {
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  // --- document text ------------------------------------------------------

  const [docVersion, setDocVersion] = createSignal(0);
  const bump = () => setDocVersion((v) => v + 1);
  props.handle.on("change", bump);
  onCleanup(() => props.handle.off("change", bump));

  const text = createMemo(() => {
    docVersion();
    return contentText(props.handle.doc());
  });

  const rows = createMemo<CsvCell[][]>(() => {
    const t = text();
    if (t == null) return [];
    const extension = props.handle.doc()?.extension;
    return parseCsv(t, sniffDelimiter(extension, t.split("\n", 1)[0] ?? ""));
  });

  // --- provenance sources (ranges of this file other docs came from) -------

  const [sources, setSources] = createSignal<ProvenanceSource[]>([]);

  onCleanup(
    subscribe<ProvenanceLink[]>(
      props.element,
      { type: "patchwork:provenance", url: props.handle.url },
      (links) => void applyLinks(links),
    ),
  );

  // Scopes links to the ones whose SOURCE lives in this doc, dedupes by
  // source ref, and resolves each source to a live handle.
  async function applyLinks(links: ProvenanceLink[]) {
    const repo = props.repo;
    if (!repo) return;
    const targetsBySource = new Map<AutomergeUrl, Set<AutomergeUrl>>();
    for (const link of links) {
      if (!link.sourceUrl.startsWith(props.handle.url)) continue;
      let targets = targetsBySource.get(link.sourceUrl);
      if (!targets) {
        targetsBySource.set(link.sourceUrl, (targets = new Set()));
      }
      targets.add(link.targetUrl);
    }
    const next: ProvenanceSource[] = [];
    for (const [sourceUrl, targets] of targetsBySource) {
      next.push({
        handle: await repo.find(sourceUrl),
        targetUrls: [...targets],
      });
    }
    if (disposed) return;
    setSources(next);
  }

  // --- shared focus (selection/highlight from other views) -----------------

  const [focusUrls, setFocusUrls] = createSignal<Set<string>>(new Set());
  const [emphasisHandles, setEmphasisHandles] = createSignal<
    DocHandle<unknown>[]
  >([]);

  let focusHandle: DocHandle<FocusDoc> | undefined;
  const onFocusChange = () => void refreshEmphasis();

  onCleanup(
    subscribe<AutomergeUrl>(
      props.element,
      { type: "patchwork:focus" },
      (url) => void attachFocus(url),
    ),
  );
  onCleanup(() => focusHandle?.off("change", onFocusChange));

  async function attachFocus(url: AutomergeUrl) {
    const repo = props.repo;
    if (!repo) return;
    focusHandle?.off("change", onFocusChange);
    const handle = await repo.find<FocusDoc>(url);
    if (disposed) return;
    focusHandle = handle;
    handle.on("change", onFocusChange);
    await refreshEmphasis();
  }

  // Focus refs (selection ∪ highlight) scoped to this doc, resolved to
  // handles so the span memo can test overlap against the source ranges. The
  // raw url set is kept too: a source range is also emphasised when the focus
  // holds one of its TARGETS, which never resolves into this doc.
  async function refreshEmphasis() {
    const repo = props.repo;
    const doc = focusHandle?.doc();
    if (!repo) return;
    const urls = [
      ...Object.keys(doc?.selection ?? {}),
      ...Object.keys(doc?.highlight ?? {}),
    ] as AutomergeUrl[];
    const refs: DocHandle<unknown>[] = [];
    for (const url of urls) {
      if (url.startsWith(props.handle.url)) {
        refs.push(await repo.find(url));
      }
    }
    if (disposed) return;
    setFocusUrls(new Set(urls));
    setEmphasisHandles(refs);
  }

  // --- spans: source ranges as plain offsets, with emphasis resolved -------

  // Ranges are re-read from the ref handles on every doc change (edits move
  // them) and whenever sources or focus change.
  const spans = createMemo<SourceSpan[]>(() => {
    docVersion();
    const urls = focusUrls();
    const emphasis = emphasisHandles();
    const out: SourceSpan[] = [];
    for (const source of sources()) {
      const positions = source.handle.rangePositions();
      if (!positions) continue;
      const [start, end] = positions;
      if (start === end) continue;
      const emphasised =
        source.targetUrls.some((url) => urls.has(url)) ||
        emphasis.some((ref) => {
          const p = ref.rangePositions();
          return p != null && p[0] < end && p[1] > start;
        });
      out.push({
        start,
        end,
        sourceUrl: source.handle.url,
        targetUrls: source.targetUrls,
        emphasised,
      });
    }
    return out;
  });

  const spansFor = (cell: CsvCell): SourceSpan[] =>
    spans().filter((s) => s.start < cell.end && s.end > cell.start);

  // --- outbound: cell click → shared focus selection -----------------------

  const [selected, setSelected] = createSignal<string>();

  // Our contribution to the shared selection, replaced wholesale on every
  // click and withdrawn on unmount, so stale entries never accumulate.
  let pushedUrls: AutomergeUrl[] = [];
  const pushFocus = (urls: AutomergeUrl[]) => {
    if (!focusHandle) return;
    if (urls.length === 0 && pushedUrls.length === 0) return;
    focusHandle.change((doc) => {
      if (!doc.selection) doc.selection = {};
      for (const url of pushedUrls) delete doc.selection[url];
      for (const url of urls) doc.selection[url] = true;
    });
    pushedUrls = urls;
  };
  onCleanup(() => pushFocus([]));

  const onCellClick = (key: string, cell: CsvCell) => {
    setSelected(key);
    const urls = new Set<AutomergeUrl>();
    for (const span of spansFor(cell)) {
      urls.add(span.sourceUrl);
      for (const target of span.targetUrls) urls.add(target);
    }
    pushFocus([...urls]);
  };

  // --- render ---------------------------------------------------------------

  const cellView = (rowIndex: number, colIndex: number, cell: CsvCell) => {
    const key = `${rowIndex}:${colIndex}`;
    const overlapping = createMemo(() => spansFor(cell));
    return (
      <td
        classList={{
          "csv-cell": true,
          "is-linked": overlapping().length > 0,
          "is-emphasised": overlapping().some((s) => s.emphasised),
          "is-selected": selected() === key,
        }}
        onClick={() => onCellClick(key, cell)}
      >
        {cell.value}
      </td>
    );
  };

  return (
    <div class="csv-tool">
      <Show
        when={text() != null}
        fallback={
          <div class="csv-empty">
            This file has binary content — nothing to show as CSV.
          </div>
        }
      >
        <Show
          when={rows().length > 0}
          fallback={<div class="csv-empty">Empty file.</div>}
        >
          <table class="csv-table">
            <tbody>
              <For each={rows()}>
                {(row, rowIndex) => (
                  <tr>
                    <For each={row}>
                      {(cell, colIndex) =>
                        cellView(rowIndex(), colIndex(), cell)
                      }
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </Show>
    </div>
  );
}

// A file's content as text, or null when it is binary. Mirrors the file
// datatype's getFileContents: content is a string, a Uint8Array, or an
// automerge ImmutableString (which stringifies).
function contentText(doc: FileDoc | undefined): string | null {
  const content = doc?.content;
  if (typeof content === "string") return content;
  if (content instanceof Uint8Array) return null;
  if (content != null && typeof content === "object") return String(content);
  return null;
}
