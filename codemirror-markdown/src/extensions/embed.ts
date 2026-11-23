import {
  EditorView,
  Decoration,
  WidgetType,
  ViewPlugin,
  ViewUpdate,
  dropCursor,
  type DecorationSet,
} from "@codemirror/view";
import { Range, StateField, type Text } from "@codemirror/state";
import {
  type AutomergeUrl,
  type DocumentId,
  isValidDocumentId,
  parseAutomergeUrl,
} from "@automerge/automerge-repo/slim";
import { embedTheme } from "../themes/embed.ts";
import { selectedOver } from "./selected.ts";

/** A resized embed: its width (unset = the text's full width) and height, px. */
type Size = { width: number | null; height: number };

const DEFAULT_HEIGHT = 500;
const MIN_WIDTH = 160;
const MIN_HEIGHT = 88;
// a frame's 1px border, top and bottom (themes/embed.ts)
const FRAME_BORDERS = 2;
// codemirror's own padding on a line (left, right), which a block embed,
// drawn between the lines, gets as margin instead so it lines up with them
const LINE_PADDING = 8;

/**
 * The width embeds have to draw in, from the last editor measured. It's only
 * for estimating heights before an embed is drawn, so one for the page will
 * do; 0 until something's been measured.
 */
let columnWidth = 0;

const measureColumn = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.measure(view);
    }
    update(update: ViewUpdate) {
      if (update.geometryChanged) this.measure(update.view);
    }
    measure(view: EditorView) {
      view.requestMeasure({
        key: this,
        read: () => {
          const width = contentWidth(view.contentDOM) - LINE_PADDING;
          if (width > 0) columnWidth = width;
        },
      });
    }
  }
);

function contentWidth(el: HTMLElement): number {
  const style = getComputedStyle(el);
  return (
    el.clientWidth -
    (parseFloat(style.paddingLeft) || 0) -
    (parseFloat(style.paddingRight) || 0)
  );
}

/** An image's pixels, from its marker, or from having drawn it before. */
function imageSize(
  size: Size | null,
  known: Seen | undefined
): { width: number; height: number } | null {
  if (size?.width) return { width: size.width, height: size.height };
  if (known?.kind === "image" && known.width && known.height) {
    return { width: known.width, height: known.height };
  }
  return null;
}

/** How tall an image is drawn: at its size, shrunk to fit the column. */
function drawnHeight({ width, height }: { width: number; height: number }) {
  const drawn = columnWidth ? Math.min(width, columnWidth) : width;
  return Math.round((height * drawn) / width);
}

/**
 * Renders an embedded doc through the shared "embed" tool, which draws the
 * chrome and nests the content view. The inner tool travels via the
 * `embed-tool-id` attribute; tool picks come back as
 * `patchwork:embed-tool-changed` events and are persisted by rewriting the
 * marker (which recreates the widget). The frame's header only shows while the
 * embed has focus (`embed-chrome="focus"`), and its remove button comes back as
 * `patchwork:embed-remove`, which deletes the marker.
 *
 * A frame can be resized from its corner; the size goes in the marker
 * (`[patchwork:id/tool =640x400]`) and a size change keeps the same DOM, so
 * the embedded tool isn't remounted.
 *
 * An image's marker carries its size too (`[patchwork:id =1200x800]`, its
 * pixels), written when it's pasted or dropped in, so its box is drawn the
 * right size before the bytes arrive.
 *
 * A marker on a line of its own is drawn as a block, between the lines, and
 * says how tall it'll be (`estimatedHeight`). codemirror keeps a height for
 * every line, drawn or not, and scrolls by them: an embed it took for a line
 * of text would put everything past it somewhere else than it scrolled to.
 */
class EmbedWidget extends WidgetType {
  readonly docId: DocumentId;
  // `null` = no pinned tool; the embed frame uses the datatype's fallback.
  readonly toolId: string | null;
  readonly size: Size | null;
  readonly block: boolean;

  constructor(
    docId: DocumentId,
    toolId: string | null,
    size: Size | null,
    block: boolean
  ) {
    super();
    this.docId = docId;
    this.toolId = toolId;
    this.size = size;
    this.block = block;
  }

  eq(other: EmbedWidget) {
    return (
      other.docId === this.docId &&
      other.toolId === this.toolId &&
      other.block === this.block &&
      other.size?.width === this.size?.width &&
      other.size?.height === this.size?.height
    );
  }

  /** Same framed doc and tool, new size: resize in place rather than remount. */
  updateDOM(dom: HTMLElement) {
    if (
      dom.dataset.docId !== this.docId ||
      (dom.dataset.toolId ?? null) !== this.toolId ||
      dom.classList.contains("cm-embed-block") !== this.block ||
      !dom.classList.contains("cm-embed-frame")
    ) {
      return false;
    }
    applySize(dom, this.size);
    return true;
  }

  get estimatedHeight() {
    const known = seen.get(this.docId);
    const framed =
      this.toolId != null ||
      known?.kind === "frame" ||
      (this.size != null && this.size.width == null);
    if (framed) return (this.size?.height ?? DEFAULT_HEIGHT) + FRAME_BORDERS;
    const image = imageSize(this.size, known);
    // nothing in the marker and not seen yet: leave it to codemirror
    return image ? drawnHeight(image) : -1;
  }

  toDOM(view: EditorView) {
    const container = document.createElement("div");
    container.className = this.block ? "cm-embed cm-embed-block" : "cm-embed";
    container.dataset.docId = this.docId;
    if (this.toolId) container.dataset.toolId = this.toolId;
    // focusable by a click anywhere in it (not by Tab), so :focus-within —
    // which shows its frame — holds even when what's clicked can't take focus.
    container.tabIndex = -1;

    container.addEventListener("patchwork:embed-remove", (e) => {
      // Nested embeds remove themselves from their own host, not from us.
      e.stopPropagation();
      removeMarker(view, container);
    });

    // An image with no pinned tool is just drawn, with no frame round it. We
    // can't tell until the doc loads, so hold off mounting the frame until then.
    if (this.toolId) {
      this.mountFrame(view, container);
    } else {
      const cleanup = mountImageOrFrame(this.docId, this.size, container, () =>
        this.mountFrame(view, container)
      );
      cleanups.set(container, cleanup);
    }
    return container;
  }

  destroy(dom: HTMLElement) {
    cleanups.get(dom)?.();
    cleanups.delete(dom);
  }

  private mountFrame(view: EditorView, container: HTMLElement): void {
    container.classList.add("cm-embed-frame");
    const patchworkView = document.createElement("patchwork-view");
    // No heads in the url: the embed follows whatever version the host
    // resolves — the active checkpoint when one is checked out, live otherwise.
    patchworkView.setAttribute("doc-url", `automerge:${this.docId}`);
    patchworkView.setAttribute("tool-id", "embed");
    if (this.toolId) patchworkView.setAttribute("embed-tool-id", this.toolId);
    patchworkView.setAttribute("embed-chrome", "focus");
    patchworkView.setAttribute("embed-removable", "");
    // Explicit inline height: without it the element collapses to 0px (the
    // stylesheet rule isn't reliably applied here).
    patchworkView.style.display = "block";
    patchworkView.style.width = "100%";

    // Persist tool picks into the marker text. Stop propagation so nested
    // embeds don't also change the outer embed's tool.
    container.addEventListener("patchwork:embed-tool-changed", (e) => {
      e.stopPropagation();
      const toolId = (e as CustomEvent<{ toolId?: string }>).detail?.toolId;
      if (!toolId) return;
      rewriteMarker(view, container, (ref) => ({ ...ref, toolId }));
    });

    container.appendChild(patchworkView);
    container.appendChild(resizeHandle(view, container));
    applySize(container, this.size);
  }

  ignoreEvent() {
    // Atomic embed: the editor ignores all events; the frame handles them.
    return true;
  }
}

/** The embed frame's own <patchwork-view> (not one nested inside it). */
function frameOf(container: HTMLElement): HTMLElement | undefined {
  return Array.from(container.children).find(
    (el): el is HTMLElement => el.localName === "patchwork-view"
  );
}

/** Size a framed embed: its height, and its width if narrower than the text. */
function applySize(container: HTMLElement, size: Size | null): void {
  const view = frameOf(container);
  if (view) view.style.height = `${size?.height ?? DEFAULT_HEIGHT}px`;
  if (size?.width) container.style.width = `${size.width}px`;
  else container.style.removeProperty("width");
}

/**
 * The corner handle. Dragging resizes the frame live; letting go writes the
 * size into the marker. Dragged out to the text's full width it drops the
 * width, so the embed goes back to following the column.
 */
function resizeHandle(view: EditorView, container: HTMLElement): HTMLElement {
  const handle = document.createElement("div");
  handle.className = "cm-embed-resize";
  handle.title = "Resize";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-label", "Resize embed");

  let drag: {
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
    max: number;
    size?: Size;
  } | null = null;
  const frame = () => frameOf(container);

  handle.addEventListener("pointerdown", (e) => {
    const inner = frame();
    if (!inner || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture?.(e.pointerId);
    drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      width: container.getBoundingClientRect().width,
      height: inner.getBoundingClientRect().height,
      max: availableWidth(container),
    };
    container.classList.add("cm-embed-resizing");
  });

  handle.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    const width = Math.round(
      Math.min(drag.max, Math.max(MIN_WIDTH, drag.width + e.clientX - drag.x))
    );
    const height = Math.round(
      Math.max(MIN_HEIGHT, drag.height + e.clientY - drag.y)
    );
    drag.size = { width: width >= drag.max - 1 ? null : width, height };
    applySize(container, drag.size);
    // the line got taller or shorter: let the editor re-measure it.
    view.requestMeasure();
  });

  const end = (commit: boolean) => (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    handle.releasePointerCapture?.(e.pointerId);
    container.classList.remove("cm-embed-resizing");
    const { size } = drag;
    drag = null;
    if (commit && size) rewriteMarker(view, container, (ref) => ({ ...ref, size }));
  };
  handle.addEventListener("pointerup", end(true));
  handle.addEventListener("pointercancel", end(false));
  return handle;
}

/**
 * The width the embed's line gives it: the line's, less its padding. A block
 * embed has no line: the content's, less the margin standing in for one's
 * padding.
 */
function availableWidth(container: HTMLElement): number {
  const line = container.closest<HTMLElement>(".cm-line");
  if (line) return contentWidth(line);
  const parent = container.parentElement;
  return parent ? contentWidth(parent) - LINE_PADDING : Infinity;
}

/** The marker this embed's DOM stands for, read fresh from the doc. */
function markerAt(
  view: EditorView,
  container: HTMLElement
): (DocRef & { from: number; to: number }) | null {
  const from = view.posAtDOM(container);
  const line = view.state.doc.lineAt(from);
  const pattern = new RegExp(EMBED_PATTERN.source, "y");
  pattern.lastIndex = from - line.from;
  const m = pattern.exec(line.text);
  if (!m || m[1] !== container.dataset.docId) return null;
  return { from, to: from + m[0].length, ...refFromMatch(m) };
}

function rewriteMarker(
  view: EditorView,
  container: HTMLElement,
  change: (ref: DocRef) => DocRef
): void {
  const marker = markerAt(view, container);
  if (!marker) return;
  const { from, to, ...ref } = marker;
  const insert = embedSyntax(change(ref));
  if (insert === view.state.sliceDoc(from, to)) return;
  view.dispatch({ changes: { from, to, insert } });
}

function removeMarker(view: EditorView, container: HTMLElement): void {
  const marker = markerAt(view, container);
  if (!marker) return;
  let { from, to } = marker;
  // An embed on a line of its own takes its line with it.
  const { doc } = view.state;
  const line = doc.lineAt(from);
  if (line.from === from && line.to === to) {
    if (line.number < doc.lines) to += 1;
    else if (line.number > 1) from -= 1;
  }
  view.dispatch({
    changes: { from, to },
    selection: { anchor: from },
    userEvent: "delete",
  });
  view.focus();
}

const cleanups = new WeakMap<HTMLElement, () => void>();

const IMAGE_EXTENSIONS = ["svg", "png", "jpg", "jpeg", "gif", "webp", "bmp"];

type FileDoc = {
  "@patchwork"?: { type?: string };
  content?: unknown;
  mimeType?: string;
  extension?: string;
  name?: string;
};

function isImageDoc(doc: FileDoc | undefined): boolean {
  if (doc?.["@patchwork"]?.type !== "file") return false;
  if (!(doc.content instanceof Uint8Array)) return false;
  return (
    !!doc.mimeType?.startsWith("image/") ||
    IMAGE_EXTENSIONS.includes(doc.extension?.toLowerCase() ?? "")
  );
}

/**
 * What each embedded doc turned out to be, kept for the life of the page.
 *
 * CodeMirror throws a line's DOM away when it scrolls out of view and calls
 * `toDOM` again when it comes back. Waiting on `repo.find` each time would
 * remount the embed at 0px and grow it a moment later, jumping the text
 * (scrolling up, the growth lands above what you're reading). With this the
 * remount is drawn at once, at its last size. The object urls stay alive with
 * the entry, so a remounted `<img>` needs no re-decode of the bytes into a
 * blob either.
 */
type Seen =
  | { kind: "frame" }
  | {
      kind: "image";
      content: Uint8Array;
      url: string;
      name: string;
      width?: number;
      height?: number;
    };
const seen = new Map<DocumentId, Seen>();

type ImageSeen = Extract<Seen, { kind: "image" }>;

/** The cached image for this doc, made fresh if its bytes changed. */
function imageFor(docId: DocumentId, doc: FileDoc): ImageSeen {
  const prev = seen.get(docId);
  if (prev?.kind === "image" && prev.content === doc.content) return prev;
  if (prev?.kind === "image") URL.revokeObjectURL(prev.url);
  const content = doc.content as Uint8Array;
  const next: ImageSeen = {
    kind: "image",
    content,
    url: URL.createObjectURL(
      new Blob([content as BlobPart], { type: doc.mimeType || "" })
    ),
    name: doc.name ?? "",
  };
  seen.set(docId, next);
  return next;
}

/**
 * Draw an image doc as a bare `<img>` that follows the doc's content; anything
 * else (or no `window.repo`) gets the normal embed frame. A doc seen before is
 * drawn straight away from `seen`. Returns a cleanup for when the widget goes.
 *
 * Reads through the realm-local `window.repo`, so an image changed only in a
 * draft shows its main-branch bytes here.
 */
function mountImageOrFrame(
  docId: DocumentId,
  size: Size | null,
  container: HTMLElement,
  mountFrame: () => void
): () => void {
  const known = seen.get(docId);
  if (known?.kind === "frame") {
    mountFrame();
    return () => {};
  }

  // a sized image's box, held until we know what's in it, so its line isn't
  // drawn at 0px and grown a moment later
  const pixels = imageSize(size, known);
  if (pixels && known?.kind !== "image") {
    container.style.aspectRatio = `${pixels.width} / ${pixels.height}`;
    container.style.width = `min(${pixels.width}px, 100%)`;
  }
  const unreserve = () => {
    container.style.removeProperty("aspect-ratio");
    container.style.removeProperty("width");
  };
  const frame = () => {
    unreserve();
    mountFrame();
  };

  const repo = (window as unknown as { repo?: any }).repo;
  let disposed = false;
  let handle: any;
  let img: HTMLImageElement | undefined;

  const show = (image: ImageSeen) => {
    if (!img) {
      unreserve();
      container.classList.add("cm-embed-image");
      img = document.createElement("img");
      // Width/height attributes give the box its aspect ratio before the
      // image decodes (the theme keeps `height: auto`). The marker's size
      // wins; without one, the pixels it turned out to have.
      img.addEventListener("load", () => {
        const current = seen.get(docId);
        if (current?.kind !== "image" || img!.src !== current.url) return;
        current.width = img!.naturalWidth;
        current.height = img!.naturalHeight;
        if (size?.width) return;
        img!.width = current.width;
        img!.height = current.height;
      });
      container.appendChild(img);
    }
    if (img.getAttribute("src") === image.url) return;
    const box = imageSize(size, image);
    if (box) {
      img.width = box.width;
      img.height = box.height;
    } else {
      img.removeAttribute("width");
      img.removeAttribute("height");
    }
    img.alt = image.name;
    img.src = image.url;
  };

  const render = () => {
    const doc = handle.doc() as FileDoc | undefined;
    if (isImageDoc(doc)) show(imageFor(docId, doc!));
  };

  if (known?.kind === "image") show(known);

  if (!repo?.find) {
    if (!img) frame();
    return () => {};
  }

  Promise.resolve(repo.find(`automerge:${docId}`)).then(
    (h) => {
      if (disposed) return;
      handle = h;
      const doc = handle.doc();
      if (!isImageDoc(doc)) {
        if (doc) seen.set(docId, { kind: "frame" });
        img?.remove();
        container.classList.remove("cm-embed-image");
        frame();
        return;
      }
      render();
      handle.on("change", render);
    },
    () => {
      if (!disposed && !img) frame();
    }
  );

  return () => {
    disposed = true;
    handle?.off?.("change", render);
  };
}

// Marker syntax: [patchwork:docId] or [patchwork:docId/toolId], optionally
// sized: [patchwork:docId/toolId =640x400], or =x400 for just a height (ids
// can't contain `/`, `]` or spaces). We scan plain text instead of the markdown syntax tree
// on purpose: `@codemirror/language` isn't a shared singleton across
// patchwork's separately-bundled extensions, so `syntaxTree(state)` here would
// read a different `Language` facet and always come back empty.
const EMBED_PATTERN =
  /\[patchwork:([^/\]\s]+)(?:\/([^\]\s]+))?(?:\s+=(\d*)x(\d+))?\]/g;

function refFromMatch(m: RegExpExecArray): DocRef {
  const [, docId, toolId, width, height] = m;
  return {
    docId: docId as DocumentId,
    toolId: toolId ?? null,
    size: height ? { width: width ? Number(width) : null, height: Number(height) } : null,
  };
}

/** Decorate the markers between `from` and `to`, which are line-aligned. */
function scanMarkers(
  doc: Text,
  from: number,
  to: number,
  into: Range<Decoration>[]
): void {
  const text = doc.sliceString(from, to);
  EMBED_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMBED_PATTERN.exec(text)) !== null) {
    const matchFrom = from + m.index;
    const matchTo = matchFrom + m[0].length;
    const { docId, toolId, size } = refFromMatch(m);
    if (!isValidDocumentId(docId)) continue;
    const line = doc.lineAt(matchFrom);
    const block = line.from === matchFrom && line.to === matchTo;
    into.push(
      Decoration.replace({
        widget: new EmbedWidget(docId, toolId, size ?? null, block),
        block,
      }).range(matchFrom, matchTo)
    );
  }
}

/**
 * Every marker in the doc, not just the ones on screen, so codemirror knows
 * how tall the embeds it hasn't drawn are. (Block decorations have to come
 * from state, too.) A change only rescans the lines it touched; markers never
 * span lines.
 */
const embedField = StateField.define<DecorationSet>({
  create(state) {
    const found: Range<Decoration>[] = [];
    scanMarkers(state.doc, 0, state.doc.length, found);
    return Decoration.set(found);
  },
  update(decorations, tr) {
    if (!tr.docChanged) return decorations;
    const doc = tr.state.doc;
    const touched: { from: number; to: number }[] = [];
    tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      const from = doc.lineAt(fromB).from;
      const to = doc.lineAt(toB).to;
      const last = touched[touched.length - 1];
      if (last && from <= last.to + 1) last.to = Math.max(last.to, to);
      else touched.push({ from, to });
    });
    decorations = decorations.map(tr.changes);
    for (const { from, to } of touched) {
      const found: Range<Decoration>[] = [];
      scanMarkers(doc, from, to, found);
      decorations = decorations.update({
        filterFrom: from,
        filterTo: to,
        filter: () => false,
        add: found,
      });
    }
    return decorations;
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    // Atomic: the cursor skips embeds and delete removes the whole marker.
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});

/**
 * An embed under a selection is marked `cm-embed-selected` (themes/embed.ts
 * tints it): the browser's selection doesn't paint widgets. Marked on the
 * embed's element, after codemirror has drawn, rather than by a new widget:
 * a different widget would mount what's embedded all over again.
 */
const markSelectedEmbeds = EditorView.updateListener.of((update) => {
  if (!update.selectionSet && !update.docChanged && !update.viewportChanged) return;
  const { view, state } = update;
  const embeds = state.field(embedField);
  for (const el of view.contentDOM.querySelectorAll<HTMLElement>(".cm-embed")) {
    // (not one inside an editor that's embedded in this one)
    if (el.closest(".cm-content") !== view.contentDOM) continue;
    const at = view.posAtDOM(el);
    let selected = false;
    embeds.between(at, at, (from, to) => {
      if (from !== at) return;
      selected = selectedOver(state, from, to);
      return false;
    });
    el.classList.toggle("cm-embed-selected", selected);
  }
});

// MIME types we accept document drags from. Mirrors the sideboard's convention.
const PATCHWORK_DND = "text/x-patchwork-dnd";
const PATCHWORK_URLS = "text/x-patchwork-urls";

type DocRef = { docId: DocumentId; toolId: string | null; size?: Size | null };

/** Turn an automerge url or a patchwork web link into a DocumentId, or null. */
function urlToDocId(raw: string): DocumentId | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Plain automerge url (optionally carrying heads/query/subpath).
  const am = trimmed.match(/automerge:([a-zA-Z0-9]+)/);
  if (am && isValidDocumentId(am[1])) return am[1] as DocumentId;
  // Patchwork web link: #doc=<documentId> (also &doc= / ?doc=).
  const web = trimmed.match(/[#&?]doc=([a-zA-Z0-9]+)/);
  if (web && isValidDocumentId(web[1])) return web[1] as DocumentId;
  return null;
}

/**
 * Read dragged documents out of a drop event, in order of format preference.
 * Only an *explicit* `toolId` on a structured item pins the tool; otherwise we
 * embed tool-less and let the view fall back to the datatype's default tool.
 */
function extractDocRefs(dt: DataTransfer): DocRef[] {
  const refs: DocRef[] = [];
  const seen = new Set<string>();
  const push = (docId: DocumentId | null, toolId: string | null) => {
    if (!docId || seen.has(docId)) return;
    seen.add(docId);
    refs.push({ docId, toolId });
  };

  const dnd = dt.getData(PATCHWORK_DND);
  if (dnd) {
    try {
      const parsed = JSON.parse(dnd) as {
        items?: Array<{ url?: string; toolId?: string }>;
      };
      for (const item of parsed?.items ?? []) {
        if (item?.url) push(urlToDocId(item.url), item.toolId ?? null);
      }
    } catch {
      // fall through to the other formats
    }
  }
  if (refs.length > 0) return refs;

  const urls = dt.getData(PATCHWORK_URLS);
  if (urls) {
    try {
      const parsed: unknown = JSON.parse(urls);
      if (Array.isArray(parsed)) {
        for (const u of parsed) push(urlToDocId(String(u)), null);
      }
    } catch {
      // fall through
    }
  }
  if (refs.length > 0) return refs;

  const text = dt.getData("text/uri-list") || dt.getData("text/plain");
  if (text) {
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("#")) continue; // uri-list comments
      push(urlToDocId(line), null);
    }
  }
  return refs;
}

function embedSyntax({ docId, toolId, size }: DocRef): string {
  const tool = toolId ? `/${toolId}` : "";
  const sized = size ? ` =${size.width ?? ""}x${size.height}` : "";
  return `[patchwork:${docId}${tool}${sized}]`;
}

/**
 * Import each OS file (dropped from the desktop or pasted) as a Patchwork
 * `file` document, returning tool-less refs to embed. Uses the realm-local
 * `window.repo` (the documented global) — fine for creating brand-new docs,
 * which aren't subject to draft remapping.
 */
async function importFileRefs(files: Iterable<File>): Promise<DocRef[]> {
  const repo = (window as unknown as { repo?: any }).repo;
  if (!repo) {
    console.warn("[codemirror-embed] window.repo unavailable; ignoring files");
    return [];
  }
  const refs: DocRef[] = [];
  for (const file of files) {
    try {
      const mimeType = file.type || "application/octet-stream";
      const isText =
        mimeType.startsWith("text/") || mimeType === "application/json";
      const content = isText
        ? await file.text()
        : new Uint8Array(await file.arrayBuffer());
      const parts = file.name.split(".");
      const extension = parts.length > 1 ? parts.pop()! : "";
      const handle = repo.create();
      handle.change((d: any) => {
        d["@patchwork"] = { type: "file" };
        d.content = content;
        d.mimeType = mimeType;
        d.extension = extension;
        d.name = file.name;
      });
      const { documentId } = parseAutomergeUrl(handle.url as AutomergeUrl);
      if (isValidDocumentId(documentId)) {
        const size = mimeType.startsWith("image/")
          ? await pixelsOf(file)
          : null;
        refs.push({ docId: documentId as DocumentId, toolId: null, size });
      }
    } catch (err) {
      console.warn(
        "[codemirror-embed] failed to import file",
        file.name,
        err
      );
    }
  }
  return refs;
}

/** An image file's pixels, or null if it can't be decoded or has none. */
async function pixelsOf(file: File): Promise<Size | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const { naturalWidth: width, naturalHeight: height } = img;
    return width && height ? { width, height } : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Insert embeds over `from..to` (a drop point, or a pasted-over selection). */
function insertRefs(
  view: EditorView,
  from: number,
  refs: DocRef[],
  to = from
): void {
  if (refs.length === 0) return;
  // Files import asynchronously, so the doc may have shrunk in the meantime.
  const len = view.state.doc.length;
  from = Math.min(from, len);
  to = Math.min(to, len);
  let text = refs.map(embedSyntax).join("\n\n");
  // On a non-empty line, add just enough breaks to put the embed on its own line.
  const { doc } = view.state;
  const start = doc.lineAt(from);
  const end = doc.lineAt(to);
  if (/\S/.test(start.text) && from > start.from) text = "\n" + text;
  if (/\S/.test(end.text) && to < end.to) text = text + "\n";
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
}

/**
 * Drop handler that accepts:
 *  - documents dragged from the sidebar / canvases / other tools
 *    (`text/x-patchwork-dnd`, `text/x-patchwork-urls`, `text/uri-list`, and
 *    `text/plain` patchwork links), and
 *  - files dragged in from the operating system (imported as `file` docs).
 * Inserts `[patchwork:docId]` (or `[patchwork:docId/toolId]`) at the drop point.
 */
function embedDropHandlers() {
  // Only claim the *dragover* for unambiguous patchwork/OS drags — plain
  // text/uri-list can be an ordinary in-editor text drag, which we must not
  // swallow. (`Files` covers OS drags, whose `dt.files` is empty until drop.)
  const wantsDragover = (dt: DataTransfer | null): boolean =>
    !!dt &&
    (dt.types.includes("Files") ||
      dt.types.includes(PATCHWORK_DND) ||
      dt.types.includes(PATCHWORK_URLS));

  return EditorView.domEventHandlers({
    dragover(event) {
      const dt = event.dataTransfer;
      if (!wantsDragover(dt)) return false;
      event.preventDefault();
      // Doc drags insert a *reference* to the same automerge doc, so show the
      // link cursor; OS file drags genuinely copy content into new docs.
      if (dt) dt.dropEffect = dt.types.includes("Files") ? "copy" : "link";
      return true;
    },
    drop(event, view) {
      const dt = event.dataTransfer;
      if (!dt) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;

      // OS files import asynchronously; insert once the docs exist.
      if (dt.files && dt.files.length > 0) {
        event.preventDefault();
        void importFileRefs(Array.from(dt.files)).then((refs) =>
          insertRefs(view, pos, refs)
        );
        return true;
      }

      // Otherwise only handle the drop if it actually resolves to patchwork
      // docs (dnd/urls always do; uri-list/plain only for patchwork links).
      // If not, let CodeMirror handle it as a normal text drop.
      const refs = extractDocRefs(dt);
      if (refs.length === 0) return false;
      event.preventDefault();
      insertRefs(view, pos, refs);
      return true;
    },
    paste(event, view) {
      // Image pastes (screenshots, "Copy Image") become embedded `file` docs.
      // A paste that also carries text is left to CodeMirror: rich text from
      // office apps attaches a picture of itself, and a Finder copy carries
      // the file's icon alongside its name.
      const dt = event.clipboardData;
      if (!dt || dt.getData("text/plain")) return false;
      const images = Array.from(dt.files ?? []).filter((f) =>
        f.type.startsWith("image/")
      );
      if (images.length === 0) return false;
      event.preventDefault();
      const { from, to } = view.state.selection.main;
      void importFileRefs(images).then((refs) =>
        insertRefs(view, from, refs, to)
      );
      return true;
    },
  });
}

export function markdownEmbed() {
  // `dropCursor` observes events, so it coexists with our dragover handler.
  return [
    embedField,
    markSelectedEmbeds,
    measureColumn,
    embedTheme,
    embedDropHandlers(),
    dropCursor(),
  ];
}
