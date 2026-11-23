// choosing which square of a picture is you: drag it about, zoom it in
// (the account picker's cropper, in a <dialog>)
import { createSignal, onMount, Show } from "solid-js";
import type { Crop } from "./contact";

const VIEWPORT = 240;
const MAX_ZOOM = 4;

export function Cropper(props: {
  src: string;
  onCancel: () => void;
  onCrop: (crop: Crop) => void;
}) {
  const [natural, setNatural] = createSignal<{ w: number; h: number }>();
  const [zoom, setZoom] = createSignal(1);
  const [offset, setOffset] = createSignal({ x: 0, y: 0 });

  const scale = () => {
    const n = natural();
    return n ? (VIEWPORT / Math.min(n.w, n.h)) * zoom() : 1;
  };
  const size = () => {
    const n = natural()!;
    return { w: n.w * scale(), h: n.h * scale() };
  };
  const clamp = (next: { x: number; y: number }) => {
    const { w, h } = size();
    return {
      x: Math.min(0, Math.max(VIEWPORT - w, next.x)),
      y: Math.min(0, Math.max(VIEWPORT - h, next.y)),
    };
  };

  function onLoad(event: Event & { currentTarget: HTMLImageElement }) {
    const img = event.currentTarget;
    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    const s = scale();
    setOffset({
      x: (VIEWPORT - img.naturalWidth * s) / 2,
      y: (VIEWPORT - img.naturalHeight * s) / 2,
    });
  }

  function onPointerDown(event: PointerEvent & { currentTarget: HTMLElement }) {
    if (!natural()) return;
    const el = event.currentTarget;
    el.setPointerCapture(event.pointerId);
    const start = { ...offset(), px: event.clientX, py: event.clientY };
    const onMove = (move: PointerEvent) =>
      setOffset(
        clamp({
          x: start.x + move.clientX - start.px,
          y: start.y + move.clientY - start.py,
        })
      );
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  }

  function zoomTo(next: number) {
    if (!natural()) return;
    const previous = scale();
    setZoom(Math.min(MAX_ZOOM, Math.max(1, next)));
    const ratio = scale() / previous;
    const o = offset();
    setOffset(
      clamp({
        x: VIEWPORT / 2 - (VIEWPORT / 2 - o.x) * ratio,
        y: VIEWPORT / 2 - (VIEWPORT / 2 - o.y) * ratio,
      })
    );
  }

  function crop() {
    const o = offset();
    const s = scale();
    props.onCrop({ x: -o.x / s, y: -o.y / s, size: VIEWPORT / s });
  }

  // only a click that starts and ends out on the backdrop lets go, and even
  // then it asks first (so does the cancel button). dragging the picture and
  // letting go past its edge, or pressing escape, keeps you here
  const [confirming, setConfirming] = createSignal(false);
  let pressedOutside = false;
  const outside = (event: MouseEvent) => {
    if (event.target !== dialog) return false;
    const r = dialog.getBoundingClientRect();
    return (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    );
  };

  let dialog!: HTMLDialogElement;
  onMount(() => dialog.showModal());

  return (
    <dialog
      ref={dialog}
      class="settings-dialog settings-cropper"
      aria-label="Crop picture"
      onCancel={(event) => event.preventDefault()}
      onPointerDown={(event) => (pressedOutside = outside(event))}
      onClick={(event) => {
        if (pressedOutside && outside(event)) setConfirming(true);
        pressedOutside = false;
      }}
    >
      <div
        class="settings-cropper-view"
        onPointerDown={onPointerDown}
        onWheel={(event) => {
          event.preventDefault();
          zoomTo(zoom() * (1 - event.deltaY / 500));
        }}
      >
        <img
          src={props.src}
          alt=""
          draggable={false}
          onLoad={onLoad}
          style={
            natural()
              ? {
                  width: `${size().w}px`,
                  height: `${size().h}px`,
                  transform: `translate(${offset().x}px, ${offset().y}px)`,
                }
              : { visibility: "hidden" }
          }
        />
        <div class="settings-cropper-mask" />
      </div>
      <Show when={natural()}>
        <input
          class="settings-cropper-zoom"
          type="range"
          min="1"
          max={MAX_ZOOM}
          step="0.01"
          aria-label="Zoom"
          value={zoom()}
          onInput={(event) => zoomTo(event.currentTarget.valueAsNumber)}
        />
      </Show>
      <div class="settings-dialog-actions">
        <button
          type="button"
          class="settings-button"
          onClick={() => setConfirming(true)}
        >
          Cancel
        </button>
        <button
          type="button"
          class="settings-button"
          data-primary
          disabled={!natural()}
          onClick={crop}
        >
          Save
        </button>
      </div>
      <Show when={confirming()}>
        <ConfirmCancel
          onYes={props.onCancel}
          onNo={() => setConfirming(false)}
        />
      </Show>
    </dialog>
  );
}

function ConfirmCancel(props: { onYes: () => void; onNo: () => void }) {
  let dialog!: HTMLDialogElement;
  onMount(() => dialog.showModal());
  return (
    <dialog
      ref={dialog}
      class="settings-dialog settings-confirm"
      aria-label="Cancel changing pic?"
      onCancel={(event) => {
        event.preventDefault();
        props.onNo();
      }}
    >
      <p>Cancel changing pic?</p>
      <div class="settings-dialog-actions">
        <button type="button" class="settings-button" onClick={props.onNo}>
          No
        </button>
        <button
          type="button"
          class="settings-button"
          data-primary
          autofocus
          onClick={props.onYes}
        >
          Yes
        </button>
      </div>
    </dialog>
  );
}
