import {
  EditorView,
  Decoration,
  WidgetType,
  ViewPlugin,
  ViewUpdate,
  type DecorationSet,
} from "@codemirror/view";
import {
  type EditorState,
  Range,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { isValidAutomergeUrl } from "@automerge/automerge-repo/slim";
import { linkTheme } from "../themes/links.ts";

/**
 * Open a link from the editor. Automerge urls open inside Patchwork rather
 * than as a browser URL (automerge: isn't navigable); bubbles/composed so the
 * event escapes the editor and any shadow root up to whoever drives selection.
 */
export function openUrl(url: string, from: Element) {
  if (isValidAutomergeUrl(url)) {
    from.dispatchEvent(
      new CustomEvent("patchwork:open-document", {
        detail: { url },
        bubbles: true,
        composed: true,
      }),
    );
  } else {
    // GFM autolinks `www.example.com` with no scheme.
    const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
    window.open(href, "_blank", "noopener,noreferrer");
  }
}

/**
 * Widget to render a clickable link in the editor
 */
class LinkWidget extends WidgetType {
  readonly url: string;
  readonly text: string;

  constructor(url: string, text: string) {
    super();
    this.url = url;
    this.text = text;
  }

  eq(other: LinkWidget) {
    return other.url === this.url && other.text === this.text;
  }

  toDOM() {
    const link = document.createElement("a");
    link.href = this.url;
    link.textContent = this.text;
    link.className = "cm-link";
    link.title = this.url;

    link.onclick = (e) => {
      e.preventDefault();
      openUrl(this.url, link);
    };

    return link;
  }

  ignoreEvent(e: Event) {
    // Let click events through to our widget
    return e.type !== "click";
  }
}

function getLinks(view: EditorView) {
  const widgets: Range<Decoration>[] = [];
  const { state } = view;
  const selection = state.selection.main;

  for (let { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        // `<https://…>`, `<fax:…>`, `<a@b.c>`: the url, without its brackets
        if (node.name === "Autolink") {
          const url = node.node.getChild("URL");
          const inside =
            selection.from >= node.from && selection.from <= node.to;
          const spans = selection.from < node.from && selection.to > node.to;
          if (url && !inside && !spans) {
            const text = state.doc.sliceString(url.from, url.to);
            const href =
              /^[a-z][a-z0-9+.-]*:/i.test(text) || !text.includes("@")
                ? text
                : `mailto:${text}`;
            widgets.push(
              Decoration.replace({ widget: new LinkWidget(href, text) }).range(
                node.from,
                node.to
              )
            );
          }
          return;
        }

        // Match markdown link syntax
        if (node.name === "Link") {
          const linkFrom = node.from;
          const linkTo = node.to;

          // Check if cursor is inside this link
          const cursorInLink =
            selection.from >= linkFrom && selection.from <= linkTo;
          // Check if the link is inside the selection
          const selectionSpansLink =
            selection.from < linkFrom && selection.to > linkTo;

          // Replace if cursor is outside the link and there's no selection across the link
          if (!cursorInLink && !selectionSpansLink) {
            const linkText = state.doc.sliceString(linkFrom, linkTo);
            const match = linkText.match(/\[([^\]]+)\]\(([^)]+)\)/);

            if (match) {
              const [, text, url] = match;

              // Replace the entire [text](url) with just the link widget
              const deco = Decoration.replace({
                widget: new LinkWidget(url, text),
              });

              widgets.push(deco.range(linkFrom, linkTo));
            }
          }
        }
      },
    });
  }

  return Decoration.set(widgets);
}

const linkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = getLinks(view);
    }

    update(update: ViewUpdate) {
      // Recompute when doc changes, selection moves, or viewport changes
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = getLinks(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;

/**
 * The link at `pos`, if any: an inline `[text](url)`, an autolink `<url>`, a
 * GFM bare url, or the url in a `[ref]: url` definition. `from`/`to` cover
 * the whole link as written. Reference-style `[text][ref]` links have no url
 * of their own and are skipped.
 */
export function linkAt(
  state: EditorState,
  pos: number
): { from: number; to: number; url: string } | null {
  const slice = (n: SyntaxNode) => state.doc.sliceString(n.from, n.to);
  for (const side of [1, -1] as const) {
    for (
      let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side);
      node;
      node = node.parent
    ) {
      const inLink = node.parent?.name === "Link" || node.parent?.name === "Autolink";
      if (node.name === "URL" && !inLink)
        return { from: node.from, to: node.to, url: slice(node) };
      if (node.name === "Link" || node.name === "Autolink") {
        const url = node.getChild("URL");
        return url ? { from: node.from, to: node.to, url: slice(url) } : null;
      }
    }
  }
  return null;
}

export const urlAt = (state: EditorState, pos: number) =>
  linkAt(state, pos)?.url ?? null;

/**
 * The link actually under the pointer. `posAndSideAtCoords` snaps to the
 * nearest position, so without the distance check the blank space past the
 * end of a line would count as hovering a link that ends the line.
 */
function linkUnderPointer(view: EditorView, x: number, y: number) {
  const hit = view.posAndSideAtCoords({ x, y });
  if (!hit) return null;
  const at = view.coordsAtPos(hit.pos, hit.assoc);
  if (
    !at ||
    y < at.top ||
    y > at.bottom ||
    Math.abs(x - at.left) > view.defaultCharacterWidth * 1.5
  )
    return null;
  return linkAt(view.state, hit.pos);
}

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
const modHeld = (e: KeyboardEvent | MouseEvent) =>
  isMac ? e.metaKey : e.ctrlKey;

/** The one link to show as clickable: under the pointer, with Mod held. */
const setHover = StateEffect.define<{ from: number; to: number } | null>();
const hoverMark = Decoration.mark({ class: "cm-md-link-hover" });

const hoverField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setHover)) {
        deco = e.value
          ? Decoration.set(hoverMark.range(e.value.from, e.value.to))
          : Decoration.none;
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Cmd-click (Ctrl off a Mac) opens the link under the pointer, even while the
 * cursor is inside it and it's showing as raw markdown. While the key is held
 * the hovered link gets `cm-md-link-hover`, so the theme can underline it.
 */
const modClick = ViewPlugin.fromClass(
  class {
    pointer: { x: number; y: number } | null = null;
    mod = false;

    constructor(readonly view: EditorView) {}

    refresh() {
      const { view } = this;
      const link =
        this.mod && this.pointer
          ? linkUnderPointer(view, this.pointer.x, this.pointer.y)
          : null;
      let current: { from: number; to: number } | null = null;
      view.state.field(hoverField).between(0, view.state.doc.length, (from, to) => {
        current = { from, to };
      });
      const same = (a: typeof current, b: typeof current) =>
        a?.from === b?.from && a?.to === b?.to;
      const next = link && { from: link.from, to: link.to };
      if (!same(current, next)) view.dispatch({ effects: setHover.of(next) });
    }
  },
  {
    eventHandlers: {
      mousedown(event, view) {
        if (event.button !== 0 || !modHeld(event)) return false;
        const link = linkUnderPointer(view, event.clientX, event.clientY);
        if (!link) return false;
        event.preventDefault();
        openUrl(link.url, view.dom);
        return true;
      },
      mousemove(event) {
        this.pointer = { x: event.clientX, y: event.clientY };
        this.mod = modHeld(event);
        this.refresh();
      },
      mouseleave() {
        this.pointer = null;
        this.refresh();
      },
      keydown(event) {
        this.mod = modHeld(event);
        this.refresh();
      },
      keyup(event) {
        this.mod = modHeld(event);
        this.refresh();
      },
      blur() {
        this.mod = false;
        this.refresh();
      },
    },
  }
);

export function markdownLinks() {
  return [linkPlugin, hoverField, modClick, linkTheme];
}
