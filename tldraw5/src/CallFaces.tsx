// The faces of the people in your call, in the canvas.
//
// Nothing here knows about the call package. We hold a `patchwork:call-faces`
// subscription for this doc (while it's held, the call's floating faces step
// aside for anyone placed here), and it tells us who's in the call and where
// they've been put. Each face is drawn by `<patchwork-view component="call-face">`.
// Moving, sizing and removing say so with a `patchwork:call` event, and the
// call writes it into the layout doc it shares with everyone else in the call.
// With no call package, nothing answers, `here` stays false, and this renders
// nothing.
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { useEditor, useValue } from "@tldraw/tldraw";
import { useSubscribe } from "@inkandswitch/patchwork-providers-react";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  NO_FACES,
  moved,
  onScreen,
  rowAround,
  sameSpot,
  sized,
  unplaced,
  type FacesState,
  type Person,
  type Spot,
} from "./call-faces.ts";

export const CallFacesContext = createContext<{
  docUrl: AutomergeUrl;
  element: HTMLElement;
} | null>(null);

/** Goes in tldraw's `components.InFrontOfTheCanvas`. */
export function CallFacesLayer() {
  const context = useContext(CallFacesContext);
  if (!context) return null;
  return <CallFaces {...context} />;
}

type Changes = Record<string, Spot | null>;

function CallFaces({
  docUrl,
  element,
}: {
  docUrl: AutomergeUrl;
  element: HTMLElement;
}) {
  const editor = useEditor();
  // (nothing answers without a call package: NO_FACES it stays)
  const state: FacesState = useSubscribe<any>(
    element,
    { type: "patchwork:call-faces", url: docUrl },
    NO_FACES,
  );
  const camera = useValue("camera", () => editor.getCamera(), [editor]);

  const send = useCallback(
    (spots: Changes) =>
      element.dispatchEvent(
        new CustomEvent("patchwork:call", {
          bubbles: true,
          composed: true,
          detail: { action: "place-faces", url: docUrl, spots },
        }),
      ),
    [element, docUrl],
  );

  // What's being dragged now, ahead of what the call has told us, so a face
  // follows the pointer rather than the round trip.
  const [pending, setPending] = useState<Record<string, Spot>>({});
  const dragging = useRef(new Set<string>());
  useEffect(() => {
    // The call has caught up: the answer is what we asked for.
    setPending((now) => {
      const keys = Object.keys(now).filter(
        (key) => !dragging.current.has(key) && sameSpot(now[key], state.spots[key]),
      );
      if (!keys.length) return now;
      const next = { ...now };
      for (const key of keys) delete next[key];
      return next;
    });
  }, [state.spots]);

  if (!state.here) return null;

  const left = unplaced(state);
  const placed = state.people.filter((person) => state.spots[person.key]);

  const putOnCanvas = () => {
    const bounds = editor.getViewportPageBounds();
    send(rowAround(left, bounds.center, editor.getZoomLevel()));
  };

  const drag = (
    event: ReactPointerEvent,
    person: Person,
    kind: "move" | "size",
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const key = person.key;
    const start = pending[key] ?? state.spots[key];
    if (!start) return;
    const zoom = editor.getZoomLevel();
    const x0 = event.clientX;
    const y0 = event.clientY;
    let latest = start;
    let frame = 0;
    dragging.current.add(key);
    const onMove = (move: PointerEvent) => {
      const dx = (move.clientX - x0) / zoom;
      const dy = (move.clientY - y0) / zoom;
      latest = kind === "move" ? moved(start, dx, dy) : sized(start, dx, dy);
      setPending((now) => ({ ...now, [key]: latest }));
      // Everyone sees it move, one write a frame.
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        send({ [key]: latest });
      });
    };
    const onUp = () => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      removeEventListener("pointercancel", onUp);
      cancelAnimationFrame(frame);
      if (latest !== start) send({ [key]: latest });
      dragging.current.delete(key);
      // (if the call never answers, don't keep it here for ever)
      setTimeout(
        () =>
          setPending((now) => {
            if (dragging.current.has(key) || !(key in now)) return now;
            const { [key]: _gone, ...rest } = now;
            return rest;
          }),
        1500,
      );
    };
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
    addEventListener("pointercancel", onUp);
  };

  return (
    <>
      {left.length > 0 && (
        <button
          type="button"
          className="tldraw5-call-put"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={putOnCanvas}
        >
          {left.length === 1
            ? left[0].me
              ? "Put your face on the canvas"
              : `Put ${left[0].name || "a face"} on the canvas`
            : `Put ${left.length} faces on the canvas`}
        </button>
      )}
      {placed.map((person) => {
        const spot = pending[person.key] ?? state.spots[person.key];
        const at = onScreen(spot, camera);
        return (
          <div
            key={person.key}
            className="tldraw5-call-face"
            data-me={person.me ? "" : undefined}
            data-dragging={dragging.current.has(person.key) ? "" : undefined}
            tabIndex={0}
            style={{
              left: at.left,
              top: at.top,
              width: at.size,
              height: at.size,
            }}
            onPointerDown={(event) => drag(event, person, "move")}
          >
            {createElement("patchwork-view", {
              component: "call-face",
              person: person.id,
              size: String(Math.round(at.size)),
            })}
            <button
              type="button"
              className="tldraw5-call-face-off"
              title={`Take ${person.me ? "your" : `${person.name}'s`} face off the canvas`}
              aria-label={`Take ${person.me ? "your" : `${person.name}'s`} face off the canvas`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => send({ [person.key]: null })}
            >
              ×
            </button>
            <span
              className="tldraw5-call-face-size"
              role="presentation"
              onPointerDown={(event) => drag(event, person, "size")}
            />
          </div>
        );
      })}
    </>
  );
}
