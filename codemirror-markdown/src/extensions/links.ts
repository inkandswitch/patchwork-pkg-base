import {
  EditorView,
  Decoration,
  WidgetType,
  ViewPlugin,
  ViewUpdate,
  type DecorationSet,
} from "@codemirror/view";
import { type EditorState, Range } from "@codemirror/state";
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
 * The url of the link at `pos`, if any: an inline `[text](url)`, an autolink
 * `<url>`, a GFM bare url, or the url in a `[ref]: url` definition.
 * Reference-style `[text][ref]` links have no url of their own and are skipped.
 */
export function urlAt(state: EditorState, pos: number): string | null {
  for (const side of [1, -1] as const) {
    for (
      let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side);
      node;
      node = node.parent
    ) {
      if (node.name === "URL") return state.doc.sliceString(node.from, node.to);
      if (node.name === "Link" || node.name === "Autolink") {
        const url = node.getChild("URL");
        return url ? state.doc.sliceString(url.from, url.to) : null;
      }
    }
  }
  return null;
}

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
const modHeld = (e: KeyboardEvent | MouseEvent) =>
  isMac ? e.metaKey : e.ctrlKey;

/** Marks link text so it can look clickable while Mod is held. */
const linkMark = Decoration.mark({ class: "cm-md-link" });

const linkMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = this.build(update.view);
      }
    }
    build(view: EditorView) {
      const marks: Range<Decoration>[] = [];
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (node) => {
            const name = node.name;
            if (name === "Link" || name === "Autolink") {
              if (node.node.getChild("URL"))
                marks.push(linkMark.range(node.from, node.to));
              return false;
            }
            if (name === "URL") marks.push(linkMark.range(node.from, node.to));
          },
        });
      }
      return Decoration.set(marks, true);
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * Cmd-click (Ctrl off a Mac) opens the link under the pointer, even while the
 * cursor is inside it and it's showing as raw markdown. Holding the key puts
 * `cm-mod-held` on the editor so the theme can show links as clickable.
 */
const modClick = [
  EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0 || !modHeld(event)) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      const url = urlAt(view.state, pos);
      if (!url) return false;
      event.preventDefault();
      openUrl(url, view.dom);
      return true;
    },
    keydown(event, view) {
      view.dom.classList.toggle("cm-mod-held", modHeld(event));
      return false;
    },
    keyup(event, view) {
      view.dom.classList.toggle("cm-mod-held", modHeld(event));
      return false;
    },
    mousemove(event, view) {
      view.dom.classList.toggle("cm-mod-held", modHeld(event));
      return false;
    },
    mouseleave(_event, view) {
      view.dom.classList.remove("cm-mod-held");
      return false;
    },
    blur(_event, view) {
      view.dom.classList.remove("cm-mod-held");
      return false;
    },
  }),
];

export function markdownLinks() {
  return [linkPlugin, linkMarks, modClick, linkTheme];
}
