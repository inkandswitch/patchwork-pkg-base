import { createEffect } from "solid-js";

/** CodeMirror */
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  Compartment,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
  type Range,
} from "@codemirror/state";

/** Automerge */
import {
  next as A,
  type Prop as AutomergeProp,
} from "@automerge/automerge/slim";
import {
  Presence,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo/slim";

// The payload broadcast to peers: just the selection, as a pair of automerge
// cursors rather than plain offsets, so every receiver resolves it against
// its *own* view of the document and it stays glued to the text through
// concurrent edits. Identity rides on Presence's own `userId` field (the
// sender's contact url); colors are derived from it receiver-side.
type PresenceSelection = {
  start: A.Cursor;
  end: A.Cursor;
  headAtStart: boolean;
  // Sender's Date.now(); used only as a change marker (not for clock comparison)
  lastMoved: number;
};
type PresenceChannels = { selection: PresenceSelection | null };

// A remote peer's selection resolved to positions in the current document.
// `peerId` is unique per session, so two tabs of the same contact each get
// their own caret.
type RemoteSelection = {
  peerId: string;
  contactUrl: AutomergeUrl | null;
  color: string;
  from: number;
  to: number;
  head: number;
  // Changes exactly when the peer acts (moves, types, refocuses) -- the
  // widget uses it to restart its nametag fade-out countdown.
  lastMoved: number;
};

/**
 * Create a CodeMirror extension for live remote cursors, reconfigurable via a
 * Compartment (same shape as the sync/diff/readOnly extensions).
 *
 * `contactUrl` is our identity: it travels as the Presence userId, and peers
 * use it to mount our "contact-cursor" token and derive our color. It
 * returning `null` renders no presence -- that's the state before the
 * identity has loaded, and permanently so for read-only views. When the
 * accessor changes, the compartment swaps the plugin wholesale: the outgoing
 * instance stops `Presence` (sending a goodbye to peers) and the new one
 * starts fresh with the new identity.
 */
export function createPresenceExtension(
  handle: () => DocHandle<unknown>,
  path: () => AutomergeProp[],
  contactUrl: () => AutomergeUrl | null
) {
  const compartment = new Compartment();

  const extension = () => {
    const url = contactUrl();
    return url ? presence(handle(), path(), url) : [];
  };

  const createReconfigureEffect = (view: EditorView) =>
    createEffect(() => {
      view.dispatch({ effects: compartment.reconfigure(extension()) });
    });

  return [compartment.of(extension()), createReconfigureEffect] as const;
}

/**
 * Live remote cursors for collaborative text, handling presence transport,
 * broadcasting/resolving selections, rendering colored ranges and contact-cursor carets.
 * Peers are keyed by session (peerId); idle carets hide their nametag after a timeout.
 * Lifetime matches the editor: reconfiguring or closing stops presence.
 */
function presence(
  handle: DocHandle<unknown>,
  path: AutomergeProp[],
  contactUrl: AutomergeUrl
): Extension {
  const setRemoteSelections = StateEffect.define<RemoteSelection[]>();

  const field = StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },
    update(value, tr) {
      for (const e of tr.effects) {
        if (e.is(setRemoteSelections)) return buildDecorations(e.value);
      }
      // Between re-resolutions, keep the decorations glued through edits.
      if (tr.docChanged) return value.map(tr.changes);
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  const plugin = ViewPlugin.fromClass(
    class {
      private view: EditorView;
      private presence: Presence<PresenceChannels>;
      private destroyed = false;
      private broadcastQueued = false;

      constructor(view: EditorView) {
        this.view = view;
        this.presence = new Presence<PresenceChannels>({
          handle,
          userId: contactUrl,
        });
        this.presence.start({ initialState: { selection: null } });
        this.presence.on("update", this.refresh);
        this.presence.on("snapshot", this.refresh);
        this.presence.on("goodbye", this.refresh);
        this.presence.on("pruned", this.refresh);
        // Closing the page sends a goodbye, which removes us from peers
        // immediately instead of after the stale-peer timeout.
        window.addEventListener("pagehide", this.stopPresence);
      }

      update(update: ViewUpdate) {
        // Typing is considered cursor movement; local edits may not set selection explicitly, so we also check userEvent annotations
        const typed =
          update.docChanged &&
          update.transactions.some(
            (tr) => tr.annotation(Transaction.userEvent) !== undefined
          );
        if (update.focusChanged && !update.view.hasFocus) {
          // Hide our caret on peers while blurred; the peer record itself
          // stays alive via heartbeats.
          if (this.presence.running) {
            this.presence.broadcast("selection", null);
          }
        } else if (
          update.selectionSet ||
          typed ||
          (update.focusChanged && update.view.hasFocus)
        ) {
          this.scheduleBroadcast();
        }
        // Local and remote edits alike arrive as transactions (the sync
        // plugin turns automerge patches into transactions), so this
        // re-resolves peers' cursors against the updated doc. Deferred:
        // dispatching is not allowed from inside update().
        if (update.docChanged) {
          queueMicrotask(this.refresh);
        }
      }

      destroy() {
        this.destroyed = true;
        this.stopPresence();
        window.removeEventListener("pagehide", this.stopPresence);
      }

      private stopPresence = () => {
        if (this.presence.running) this.presence.stop();
      };

      // rAF-throttled (matching tldraw4) so drag-selections don't flood the
      // channel. The selection is read fresh at flush time.
      private scheduleBroadcast() {
        if (this.broadcastQueued) return;
        this.broadcastQueued = true;
        requestAnimationFrame(() => {
          this.broadcastQueued = false;
          if (this.destroyed || !this.presence.running) return;
          // Blurred in the meantime: the null broadcast already went out.
          if (!this.view.hasFocus) return;
          const doc = handle.doc();
          const sel = this.view.state.selection.main;
          this.presence.broadcast("selection", {
            start: A.getCursor(doc, path, sel.from),
            end: A.getCursor(doc, path, sel.to),
            headAtStart: sel.to > sel.from && sel.head === sel.from,
            lastMoved: Date.now(),
          });
        });
      }

      // Re-resolve every peer's cursors against the current doc. A cursor can
      // briefly fail to resolve when a presence message races ahead of doc
      // sync -- the peer is skipped and picked up again on the next change.
      private refresh = () => {
        if (this.destroyed) return;
        const doc = handle.doc();
        const resolved: RemoteSelection[] = [];
        for (const peer of this.presence.getPeerStates().peers) {
          const peerId = String(peer.peerId);
          const selection = peer.value?.selection ?? null;
          if (!selection) continue;
          try {
            const from = A.getCursorPosition(doc, path, selection.start);
            const to = A.getCursorPosition(doc, path, selection.end);
            const peerContactUrl =
              (peer.userId as AutomergeUrl | undefined) ?? null;
            resolved.push({
              peerId,
              contactUrl: peerContactUrl,
              // Same rule as the contact-cursor token (palette hash of the
              // contact url), so the tint and the token can't drift apart.
              color: generateColorFromString(peerContactUrl ?? peerId),
              from,
              to,
              head: selection.headAtStart ? from : to,
              lastMoved: selection.lastMoved,
            });
          } catch {
            continue;
          }
        }
        this.view.dispatch({ effects: setRemoteSelections.of(resolved) });
      };
    }
  );

  return [field, plugin, presenceTheme];
}

function buildDecorations(selections: RemoteSelection[]): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const sel of selections) {
    if (sel.from < sel.to) {
      ranges.push(
        Decoration.mark({
          class: "cm-presence-range",
          attributes: {
            style: `background-color: color-mix(in srgb, ${sel.color} 25%, transparent);`,
          },
        }).range(sel.from, sel.to)
      );
    }
    ranges.push(
      Decoration.widget({
        widget: new PresenceCaretWidget(sel),
        side: -1,
      }).range(sel.head)
    );
  }
  return Decoration.set(ranges, true);
}

// A peer's nametag fades out once its selection has been still for this
// long -- the caret itself stays visible. Moving the cursor or typing
// brings it back.
const LABEL_TIMEOUT_MS = 2_000;

class PresenceCaretWidget extends WidgetType {
  readonly peerId: string;
  readonly contactUrl: AutomergeUrl | null;
  readonly color: string;
  readonly lastMoved: number;
  private labelTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(sel: RemoteSelection) {
    super();
    this.peerId = sel.peerId;
    this.contactUrl = sel.contactUrl;
    this.color = sel.color;
    this.lastMoved = sel.lastMoved;
  }

  // Activity changes don't change the widget's identity. Keeping the widgets
  // equal lets CodeMirror reuse the mounted contact token as the caret moves.
  eq(other: PresenceCaretWidget) {
    return (
      other.peerId === this.peerId &&
      other.contactUrl === this.contactUrl &&
      other.color === this.color
    );
  }

  toDOM() {
    const caret = document.createElement("span");
    caret.className = "cm-presence-caret";
    caret.dataset.peerId = this.peerId;
    caret.style.setProperty("--cm-presence-color", this.color);
    this.labelTimer = setTimeout(() => {
      caret.classList.add("cm-presence-caret--idle");
    }, LABEL_TIMEOUT_MS);

    if (this.contactUrl) {
      const label = document.createElement("span");
      label.className = "cm-presence-caret-label";
      const token = document.createElement("patchwork-view");
      token.setAttribute("doc-url", this.contactUrl);
      token.setAttribute("tool-id", "contact-cursor");
      token.style.display = "block";
      label.appendChild(token);
      caret.appendChild(label);
    }

    return caret;
  }

  destroy() {
    clearTimeout(this.labelTimer);
  }
}

const presenceTheme = EditorView.baseTheme({
  // A zero-width caret line: 2px of left border cancelled out by the negative
  // margins so surrounding text doesn't shift.
  ".cm-presence-caret": {
    position: "relative",
    display: "inline",
    borderLeft: "2px solid var(--cm-presence-color)",
    marginLeft: "-1px",
    marginRight: "-1px",
    pointerEvents: "none",
  },
  ".cm-presence-caret-label": {
    position: "absolute",
    top: "-1.4em",
    left: "-2px",
    zIndex: "150",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    userSelect: "none",
    opacity: "1",
    transition: "opacity 200ms ease-in-out",
  },
  ".cm-presence-caret--idle .cm-presence-caret-label": {
    opacity: "0",
  },
});

// Deterministic presence color, hashed from the contact url. Duplicated on
// purpose from contact/src/ui.ts (same palette, same hash) so the selection
// tint matches the contact-cursor token -- a shared package is a later step.
const USER_COLOR_PALETTE = [
  "hsl(200, 70%, 50%)",
  "hsl(10, 75%, 58%)",
  "hsl(145, 70%, 45%)",
  "hsl(270, 70%, 55%)",
  "hsl(38, 85%, 50%)",
  "hsl(350, 70%, 55%)",
  "hsl(178, 70%, 45%)",
  "hsl(235, 70%, 58%)",
  "hsl(85, 70%, 45%)",
  "hsl(310, 70%, 55%)",
  "hsl(25, 80%, 52%)",
  "hsl(188, 75%, 48%)",
];

function generateColorFromString(str: string): string {
  const hash = Math.abs(
    str.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)
  );
  return USER_COLOR_PALETTE[hash % USER_COLOR_PALETTE.length];
}
