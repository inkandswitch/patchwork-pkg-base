import {
  EditorView,
  Decoration,
  WidgetType,
  ViewPlugin,
  ViewUpdate,
  dropCursor,
  type DecorationSet,
} from "@codemirror/view";
import { Range } from "@codemirror/state";
import {
  type AutomergeUrl,
  type DocumentId,
  isValidDocumentId,
  parseAutomergeUrl,
} from "@automerge/automerge-repo/slim";
import { embedTheme } from "../themes/embed.ts";

/**
 * Renders an embedded doc through the shared "embed" tool, which draws the
 * chrome and nests the content view. The inner tool travels via the
 * `embed-tool-id` attribute; tool picks come back as
 * `patchwork:embed-tool-changed` events and are persisted by rewriting the
 * marker (which recreates the widget).
 */
class EmbedWidget extends WidgetType {
  readonly docId: DocumentId;
  // `null` = no pinned tool; the embed frame uses the datatype's fallback.
  readonly toolId: string | null;
  readonly embedText: string;

  constructor(docId: DocumentId, toolId: string | null, embedText: string) {
    super();
    this.docId = docId;
    this.toolId = toolId;
    this.embedText = embedText;
  }

  eq(other: EmbedWidget) {
    return other.docId === this.docId && other.toolId === this.toolId;
  }

  toDOM(view: EditorView) {
    const container = document.createElement("div");
    container.className = "cm-embed";

    // An image with no pinned tool is just drawn, with no frame round it. We
    // can't tell until the doc loads, so hold off mounting the frame until then.
    if (this.toolId) {
      this.mountFrame(view, container);
    } else {
      const cleanup = mountImageOrFrame(this.docId, container, () =>
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
    const patchworkView = document.createElement("patchwork-view");
    // No heads in the url: the embed follows whatever version the host
    // resolves — the active checkpoint when one is checked out, live otherwise.
    patchworkView.setAttribute("doc-url", `automerge:${this.docId}`);
    patchworkView.setAttribute("tool-id", "embed");
    if (this.toolId) patchworkView.setAttribute("embed-tool-id", this.toolId);
    // Explicit inline height: without it the element collapses to 0px (the
    // stylesheet rule isn't reliably applied here).
    patchworkView.style.display = "block";
    patchworkView.style.height = "500px";
    patchworkView.style.width = "100%";

    // Persist tool picks into the marker text. Stop propagation so nested
    // embeds don't also change the outer embed's tool.
    container.addEventListener("patchwork:embed-tool-changed", (e) => {
      e.stopPropagation();
      const toolId = (e as CustomEvent<{ toolId?: string }>).detail?.toolId;
      if (toolId) this.setTool(view, container, toolId);
    });

    container.appendChild(patchworkView);
  }

  private setTool(
    view: EditorView,
    container: HTMLElement,
    toolId: string
  ): void {
    const from = view.posAtDOM(container);
    const to = from + this.embedText.length;
    // Only rewrite if the marker is still exactly where this widget maps to.
    if (view.state.doc.sliceString(from, to) !== this.embedText) return;
    view.dispatch({
      changes: { from, to, insert: embedSyntax({ docId: this.docId, toolId }) },
    });
  }

  ignoreEvent() {
    // Atomic embed: the editor ignores all events; the frame handles them.
    return true;
  }
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
  container: HTMLElement,
  mountFrame: () => void
): () => void {
  const known = seen.get(docId);
  if (known?.kind === "frame") {
    mountFrame();
    return () => {};
  }

  const repo = (window as unknown as { repo?: any }).repo;
  let disposed = false;
  let handle: any;
  let img: HTMLImageElement | undefined;

  const show = (image: ImageSeen) => {
    if (!img) {
      container.classList.add("cm-embed-image");
      img = document.createElement("img");
      // Width/height attributes give the box its aspect ratio before the
      // image decodes (the theme keeps `height: auto`).
      img.addEventListener("load", () => {
        const current = seen.get(docId);
        if (current?.kind !== "image" || img!.src !== current.url) return;
        current.width = img!.naturalWidth;
        current.height = img!.naturalHeight;
        img!.width = current.width;
        img!.height = current.height;
      });
      container.appendChild(img);
    }
    if (img.getAttribute("src") === image.url) return;
    if (image.width && image.height) {
      img.width = image.width;
      img.height = image.height;
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
    if (!img) mountFrame();
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
        mountFrame();
        return;
      }
      render();
      handle.on("change", render);
    },
    () => {
      if (!disposed && !img) mountFrame();
    }
  );

  return () => {
    disposed = true;
    handle?.off?.("change", render);
  };
}

// Marker syntax: [patchwork:docId] or [patchwork:docId/toolId] (ids can't
// contain `/` or `]`). We scan plain text instead of the markdown syntax tree
// on purpose: `@codemirror/language` isn't a shared singleton across
// patchwork's separately-bundled extensions, so `syntaxTree(state)` here would
// read a different `Language` facet and always come back empty.
const EMBED_PATTERN = /\[patchwork:([^/\]]+)(?:\/([^\]]+))?\]/g;

function getEmbedLinks(view: EditorView) {
  const widgets: Range<Decoration>[] = [];
  const { state } = view;

  // Visible ranges are line-aligned and markers never span lines, so a marker
  // is always fully inside or fully outside a range.
  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to);
    EMBED_PATTERN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = EMBED_PATTERN.exec(text)) !== null) {
      const matchFrom = from + m.index;
      const matchTo = matchFrom + m[0].length;
      const [matchText, docId, toolId] = m;

      if (!isValidDocumentId(docId)) continue;

      const embed = Decoration.replace({
        widget: new EmbedWidget(docId as DocumentId, toolId ?? null, matchText),
      });
      widgets.push(embed.range(matchFrom, matchTo));
    }
  }

  // `true` lets CodeMirror sort the ranges defensively (matches are already in
  // document order, but this is cheap insurance).
  return Decoration.set(widgets, true);
}

// MIME types we accept document drags from. Mirrors the sideboard's convention.
const PATCHWORK_DND = "text/x-patchwork-dnd";
const PATCHWORK_URLS = "text/x-patchwork-urls";

type DocRef = { docId: DocumentId; toolId: string | null };

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

function embedSyntax({ docId, toolId }: DocRef): string {
  return toolId ? `[patchwork:${docId}/${toolId}]` : `[patchwork:${docId}]`;
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
        refs.push({ docId: documentId as DocumentId, toolId: null });
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

const embedPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = getEmbedLinks(view);
    }

    update(update: ViewUpdate) {
      // Viewport too, so newly-visible markers get decorated.
      if (update.docChanged || update.viewportChanged) {
        this.decorations = getEmbedLinks(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    // Atomic: the cursor skips embeds and delete removes the whole marker.
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.decorations ?? Decoration.none
      ),
  }
);

export function markdownEmbed() {
  // `dropCursor` observes events, so it coexists with our dragover handler.
  return [embedPlugin, embedTheme, embedDropHandlers(), dropCursor()];
}
