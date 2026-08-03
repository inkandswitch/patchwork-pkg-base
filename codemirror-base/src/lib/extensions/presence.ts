import { createEffect } from "solid-js";

/** CodeMirror */
import {
  Decoration,
  EditorView,
  RectangleMarker,
  ViewPlugin,
  layer,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  Compartment,
  EditorSelection,
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
  // caret marker uses it to restart its nametag fade-out countdown.
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

  const remoteSelectionField = StateField.define<RemoteSelection[]>({
    create() {
      return [];
    },
    update(value, tr) {
      // Between re-resolutions, keep positions glued through edits.
      if (tr.docChanged) {
        value = value.map((sel) => ({
          ...sel,
          from: tr.changes.mapPos(sel.from),
          to: tr.changes.mapPos(sel.to),
          head: tr.changes.mapPos(sel.head),
        }));
      }
      for (const e of tr.effects) {
        if (e.is(setRemoteSelections)) value = e.value;
      }
      return value;
    },
    // Selection tints are plain mark decorations: they carry no stateful
    // DOM, so redrawing them is invisible.
    provide: (f) => EditorView.decorations.from(f, buildSelectionTints),
  });

  // Carets and their nametags are rendered in a layer (not as widget decorations)
  // to prevent remounts and visible flicker. This ensures the <patchwork-view>
  // element stays mounted and updated in place, even during edits.
  const caretLayer = layer({
    above: true,
    class: "cm-presence-layer",
    update: (update) =>
      update.docChanged ||
      update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(setRemoteSelections))
      ),
    markers(view) {
      // Stable order, so the layer's pairwise DOM reuse matches each marker
      // with the same peer's existing element across redraws.
      const selections = [...view.state.field(remoteSelectionField)].sort(
        (a, b) => (a.peerId < b.peerId ? -1 : a.peerId > b.peerId ? 1 : 0)
      );
      const markers: PresenceCaretMarker[] = [];
      for (const sel of selections) {
        // Reuse drawSelection's measurement for a caret rectangle at head.
        const [rect] = RectangleMarker.forRange(
          view,
          "cm-presence-caret",
          EditorSelection.cursor(sel.head)
        );
        if (!rect) continue; // outside the rendered viewport
        markers.push(
          new PresenceCaretMarker(sel, rect.left, rect.top, rect.height)
        );
      }
      return markers;
    },
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

  return [remoteSelectionField, caretLayer, plugin, presenceTheme];
}

function buildSelectionTints(selections: RemoteSelection[]): DecorationSet {
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
  }
  return Decoration.set(ranges, true);
}

// A peer's nametag fades out once its selection has been still for this
// long -- the caret itself stays visible. Moving the cursor or typing
// brings it back.
const LABEL_TIMEOUT_MS = 2_000;

// A layer marker for one peer's caret. Markers are throwaway value objects
// (a fresh set arrives with every measure pass); the peer's DOM element is
// what persists, via `update` mutating it in place. That persistence is the
// point of the layer approach: the contact token inside must never remount.
class PresenceCaretMarker {
  private readonly sel: RemoteSelection;
  private readonly left: number;
  private readonly top: number;
  private readonly height: number;

  constructor(sel: RemoteSelection, left: number, top: number, height: number) {
    this.sel = sel;
    this.left = left;
    this.top = top;
    this.height = height;
  }

  eq(other: PresenceCaretMarker): boolean {
    return (
      other.sel.peerId === this.sel.peerId &&
      other.sel.contactUrl === this.sel.contactUrl &&
      other.sel.color === this.sel.color &&
      other.sel.lastMoved === this.sel.lastMoved &&
      other.left === this.left &&
      other.top === this.top &&
      other.height === this.height
    );
  }

  draw(): HTMLElement {
    const caret = document.createElement("div");
    caret.className = "cm-presence-caret";
    caret.dataset.peerId = this.sel.peerId;
    if (this.sel.contactUrl) {
      const label = document.createElement("span");
      label.className = "cm-presence-caret-label";
      const token = document.createElement("patchwork-view");
      token.setAttribute("doc-url", this.sel.contactUrl);
      token.setAttribute("tool-id", "contact-cursor");
      token.style.display = "block";
      label.appendChild(token);
      caret.appendChild(label);
    }
    this.adjust(caret);
    restartIdleCountdown(caret);
    return caret;
  }

  // Reposition the peer's existing element instead of redrawing it, keeping
  // the mounted contact token alive (a remount re-renders asynchronously and
  // flickers -- see the layer comment in `presence`).
  update(dom: HTMLElement, prev: PresenceCaretMarker): boolean {
    // A different peer means a different contact token, which genuinely has
    // to remount. Only happens when peers join or leave.
    if (
      prev.sel.peerId !== this.sel.peerId ||
      prev.sel.contactUrl !== this.sel.contactUrl
    ) {
      return false;
    }
    this.adjust(dom);
    // Fresh activity restarts the nametag fade-out. Position shifts caused
    // by other people's edits deliberately don't.
    if (prev.sel.lastMoved !== this.sel.lastMoved) restartIdleCountdown(dom);
    return true;
  }

  private adjust(dom: HTMLElement) {
    dom.style.left = `${this.left}px`;
    dom.style.top = `${this.top}px`;
    dom.style.height = `${this.height}px`;
    dom.style.setProperty("--cm-presence-color", this.sel.color);
  }
}

// Keyed on the DOM element rather than the marker, because marker instances
// are replaced on every measure pass while the element lives on.
const idleTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function restartIdleCountdown(caret: HTMLElement) {
  clearTimeout(idleTimers.get(caret));
  caret.classList.remove("cm-presence-caret--idle");
  idleTimers.set(
    caret,
    setTimeout(
      () => caret.classList.add("cm-presence-caret--idle"),
      LABEL_TIMEOUT_MS
    )
  );
}

const presenceTheme = EditorView.baseTheme({
  // Positioned absolutely by the layer (document-relative); -1px centers
  // the 2px bar on the caret position.
  ".cm-presence-caret": {
    borderLeft: "2px solid var(--cm-presence-color)",
    marginLeft: "-1px",
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
