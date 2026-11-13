// a call's faces, and the question before you're in one (from lattice's
// wm/call/ui.js). someone's face in the control panel, clicked, fills the
// stage (CallStage), and that, double clicked, the screen. in the video tab,
// clicked, they fill its box. floating, each face can be put away, and
// dragged out of the control panel again (DragOut)
import { createEffect, createMemo, createSignal, For, Show, onCleanup } from "solid-js";
import html from "solid-js/html";
import { call, onCallIn, join, setFloating, hideFloating, showFloating, toggleStage, setFull, closeStage } from "../engine/call.js";
import { tilesFor } from "../engine/sizes.js";
import { hearing } from "../engine/speaking.js";
import { ringWave, louder, wiggle, WIGGLE_HEARD, WIGGLE_HOLD } from "../engine/wiggle.js";
import { faceImage } from "./avatar.js";
import { centreOn } from "../engine/face.js";
import { colourFor } from "./colour.js";
import { icon } from "./icons.js";
import { bringAlong } from "./along.js";

const initial = (name) => (String(name ?? "")[0] ?? "?").toUpperCase();

// "chee", "chee and mimi", "chee, mimi and agnes"
export function names(list) {
  if (list.length < 2) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

// a <video> of `stream()` (null for none), always quiet: the sound is the
// call's own to play, once. it's centred on `face()` (face.js), where that's
// known, as its box and the picture change
function videoOf(stream, face) {
  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  const centre = () => centreOn(video, face());
  video.addEventListener("loadedmetadata", centre);
  video.addEventListener("resize", centre);
  const resized = new ResizeObserver(centre);
  resized.observe(video);
  createEffect(centre);
  onCleanup(() => resized.disconnect());
  let tracks = -1;
  createEffect(() => {
    const now = stream();
    const count = now?.getVideoTracks().length ?? 0;
    // a track added to the stream it already has isn't always picked up
    if (video.srcObject !== now || count !== tracks) {
      video.srcObject = null;
      video.srcObject = now;
    }
    tracks = count;
    if (now) video.play().catch(() => {});
  });
  onCleanup(() => (video.srcObject = null));
  return video;
}

/**
 * someone in the call (`props.id`, or "me" for you), as a round face: their
 * pictures while their camera's on, else their avatar, or their initial.
 * `props.size` is in px; `props.shape` "round" (the default) or "tile";
 * `props.muted` false leaves out saying they're muted (it's said beside
 * their name instead)
 */
export function Face(props) {
  const mine = () => props.id === "me";
  const person = () =>
    mine()
      ? { ...call.me(), mic: call.get()?.mic, camera: call.get()?.camera, face: call.get()?.face }
      : call.peers().find((peer) => peer.id === props.id);
  const stream = () => (mine() ? call.local() : person()?.camera ? call.stream(props.id) : null);
  const video = videoOf(stream, () => person()?.face ?? null);
  const image = () => faceImage(person()?.avatar);
  return html`<span
    class="patchwork-call-face"
    data-shape=${() => props.shape ?? "round"}
    data-mine=${() => (mine() ? "" : undefined)}
    data-camera=${() => (stream() ? "" : undefined)}
    data-connecting=${() => (!mine() && person()?.connection !== "connected" ? "" : undefined)}
    data-speaking=${() => ((mine() ? call.get()?.speaking : person()?.speaking) ? "" : undefined)}
    style=${() => ({
      // theirs, or one for them, as presence would give them
      "--call-face": person() ? person().colour || colourFor(person().contact || props.id) : null,
      "--call-face-size": props.size ? `${props.size}px` : null,
      "background-image": !stream() && image() ? `url("${image()}")` : null,
    })}
    title=${() => (props.title === false ? undefined : mine() ? "you" : person()?.name)}
  >
    ${() => (stream() ? video : image() ? "" : initial(person()?.name))}
    <${Show} when=${() => props.muted !== false && person() && !person().mic}>
      <span class="patchwork-call-muted" aria-label="muted">${icon("mic-off", 9)}</span>
    <//>
    <${Show} when=${() => (mine() ? call.get()?.screen : person()?.screen)}>
      <span class="patchwork-call-sharing" aria-label="sharing their screen" title="sharing their screen"
        >${icon("screen", 9)}</span
      >
    <//>
  </span>`;
}

/** someone's screen (`props.id`), while they're sharing it: all of it */
export function Screen(props) {
  const video = videoOf(() => call.screen(props.id), () => null);
  return html`<span class="patchwork-call-screen">${video}</span>`;
}

/**
 * someone big (`props.id`): their screen while they're sharing it, with
 * their face small in its corner, else their face
 */
function Picture(props) {
  return html`<${Show}
    when=${() => call.screen(props.id)}
    fallback=${html`<${Face} id=${props.id} shape="tile" muted=${false} title=${false} />`}
  >
    <${Screen} id=${props.id} />
    <span class="patchwork-call-them"><${Face} id=${props.id} shape="tile" muted=${false} title=${false} /></span>
  <//>`;
}

/**
 * the question: share your video, and call (or join the one that's on).
 * shows when something's pressed to ask (call.js's ask), where it asked, or
 * else near the top left. pressed, it's yours to answer: it has the focus
 */
export function CallQuestion() {
  let popover;
  let first;
  const asking = call.asking;
  const others = createMemo(() => (asking() ? onCallIn(asking().url) : []));
  const elsewhere = () => {
    const now = call.get();
    return now && asking() && now.room !== asking().url ? now : null;
  };

  createEffect(() => {
    const now = asking();
    if (!popover) return;
    if (!now) {
      popover.removeAttribute("data-open");
      if (popover.matches?.(":popover-open")) popover.hidePopover();
      return;
    }
    const at = now.at ?? { x: 16, y: 16 };
    popover.style.left = `${Math.max(8, Math.min(at.x, innerWidth - 268))}px`;
    popover.style.top = `${Math.max(8, Math.min(at.y, innerHeight - 180))}px`;
    popover.setAttribute("data-open", "");
    try {
      if (!popover.matches(":popover-open")) popover.showPopover();
    } catch {}
    first?.focus({ preventScroll: true });
  });

  function go(video) {
    const now = asking();
    call.stopAsking();
    if (now) join(now.url, { video });
  }

  return html`<div
    class="patchwork-call-question"
    popover="auto"
    role="dialog"
    aria-label="a call"
    ref=${(el) => (popover = el)}
    onToggle=${(event) => event.newState === "closed" && call.stopAsking()}
  >
    <${Show}
      when=${() => others().length}
      fallback=${html`<p class="patchwork-call-question-title">start a call here?</p>`}
    >
      <div class="patchwork-call-question-who">
        <span class="patchwork-call-question-faces">
          <${For} each=${others}>
            ${(person) => {
              const image = faceImage(person.who.avatar);
              return html`<span
                class="patchwork-call-face"
                style=${{ "--call-face": person.who.colour || null, "background-image": image ? `url("${image}")` : null }}
                >${image ? "" : initial(person.who.name)}</span
              >`;
            }}
          <//>
        </span>
        <p class="patchwork-call-question-title">
          ${() => `${names([...new Set(others().map((person) => person.who.name))])} on a call`}
        </p>
      </div>
    <//>
    <p class="patchwork-call-question-ask">share your video?</p>
    <div class="patchwork-call-question-buttons">
      <button class="patchwork-call-go" ref=${(el) => (first = el)} onClick=${() => go(true)}>
        ${icon("video", 13)} video on
      </button>
      <button class="patchwork-call-go" data-quiet="" onClick=${() => go(false)}>${icon("mic", 13)} just voice</button>
    </div>
    <div class="patchwork-call-question-foot">
      <span>${() => (elsewhere() ? `leaves the call in ${call.nameOf(elsewhere().room) || "another doc"}` : "")}</span>
      <button class="patchwork-call-not-now" onClick=${() => call.stopAsking()}>not now</button>
    </div>
  </div>`;
}

// over everything (the top layer, as a frame's own popovers are), once it's
// on the page; then `after()`
function onTop(el, after) {
  queueMicrotask(() => {
    try {
      if (el.isConnected && !el.matches(":popover-open")) el.showPopover();
    } catch {}
    after?.();
  });
}

// back on top of the top layer, which stacks by what was shown last, not by
// z-index: floating faces over the stage, as they were in lattice
function raise(el) {
  if (!el) return;
  try {
    if (!el.matches(":popover-open")) return;
    el.hidePopover();
    el.showPopover();
  } catch {}
}

// where the stage goes, as a style: the box, or the whole window
function boxStyle(box) {
  return box
    ? { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` }
    : { left: "0px", top: "0px", width: "100%", height: "100%" };
}

// a floating face's width, to start with, and as small and big as it goes
const FLOAT_MIN = 72;
const FLOAT_MAX = 640;
// to start with, everyone else bigger than you
const THEIR_WIDTH = 200;
const MY_WIDTH = 120;

// a little, but always the same little, for `key`: -1 to 1
function nudge(key) {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return ((Math.abs(hash) % 1000) / 1000) * 2 - 1;
}

// where a floating face starts (fractions of the window): you in the bottom
// right, and everyone else (`index`: which of them) at the left of `panes`
// (a box: where they are), near the call, a little way down, two across and
// a few down, each nudged out of line a little
function startAt(index, key, panes) {
  if (key === "me") {
    return {
      x: 1 - (MY_WIDTH + 24) / innerWidth,
      y: 1 - (MY_WIDTH * 0.75 + 56) / innerHeight,
      width: MY_WIDTH,
    };
  }
  const column = index % 2;
  const row = Math.floor(index / 2);
  const area = panes?.width ? panes : { left: innerWidth * 0.25, top: 0, height: innerHeight };
  const left = area.left + 40 + column * (THEIR_WIDTH + 32) + (row % 2) * 48 + nudge(`${key}x`) * 20;
  const top = area.top + area.height * 0.24 + row * (THEIR_WIDTH * 0.75 + 56) + nudge(`${key}y`) * 20;
  return { x: left / innerWidth, y: top / innerHeight, width: THEIR_WIDTH };
}

// where a floating face goes: where it was put, but all of it in the window
// (a face sized bigger near an edge moves away from it)
function inWindow({ x, y, width }) {
  const height = width * 0.75 + 24;
  return {
    left: `${Math.max(0, Math.min(x * innerWidth, innerWidth - width - 8))}px`,
    top: `${Math.max(0, Math.min(y * innerHeight, innerHeight - height - 8))}px`,
  };
}

// ── a floating face going to the call bar, and coming out of it ─────────

// on screen, moving: in and out. coming in: out
const EASE_MOVE = "cubic-bezier(0.77, 0, 0.175, 1)";
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// someone's face in the call bar: where their floating face goes to, and
// comes from. scrolled along out of sight, it's brought back into it first
function inBar(id) {
  const face = document.querySelector(`.patchwork-call-panel [data-call-face="${CSS.escape(id)}"]`);
  bringAlong(face);
  return face;
}

// the transform that puts `float`'s picture over `target`, and the origin it's
// from (the picture's middle), or null if either isn't on screen
function towards(float, target) {
  const picture = float.querySelector(".patchwork-call-float-picture")?.getBoundingClientRect();
  const box = float.getBoundingClientRect();
  const to = target?.getBoundingClientRect();
  if (!picture?.width || !to?.width) return null;
  const x = picture.left + picture.width / 2;
  const y = picture.top + picture.height / 2;
  return {
    origin: `${x - box.left}px ${y - box.top}px`,
    transform: `translate(${to.left + to.width / 2 - x}px, ${to.top + to.height / 2 - y}px) scale(${to.width / picture.width})`,
  };
}

// put away: it goes into their face in the call bar, then it's gone
function minimise(float, id, done) {
  const to = reducedMotion() ? null : towards(float, inBar(id));
  float.style.pointerEvents = "none";
  const motion = to
    ? float.animate(
        [
          { transformOrigin: to.origin, transform: "none", opacity: 1 },
          { transformOrigin: to.origin, transform: to.transform, opacity: 0.3 },
        ],
        { duration: 240, easing: EASE_MOVE, fill: "forwards" },
      )
    : float.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: "ease-out", fill: "forwards" });
  motion.finished.then(done, done);
}

// the ones just dragged out of the call bar: they're where they were let go,
// not coming out of it
const dropped = new Set();

// arriving (you've joined, they have, or faces are floating now): out of
// their face in the call bar to where it goes, one after another
function arrive(float, id, key, index) {
  if (dropped.delete(key) || reducedMotion()) {
    float.animate([{ opacity: 0, scale: 0.95 }, { opacity: 1, scale: 1 }], { duration: 160, easing: EASE_OUT });
    return;
  }
  const from = towards(float, inBar(id));
  if (!from) {
    float.animate([{ opacity: 0, scale: 0.95 }, { opacity: 1, scale: 1 }], { duration: 200, easing: EASE_OUT });
    return;
  }
  float.animate(
    [
      { transformOrigin: from.origin, transform: from.transform, opacity: 0.3 },
      { transformOrigin: from.origin, transform: "none", opacity: 1 },
    ],
    { duration: 280, delay: Math.min(index, 8) * 40, easing: EASE_OUT, fill: "backwards" },
  );
}

// ── the wiggle round a floating face, while they're speaking ───────────

const WIGGLE_POINTS = 160;
// how much of their sound goes round (of the analyser's 2048: about 20ms)
const WIGGLE_SPAN = 1024;
// how far past the picture it can go (the canvas is that much bigger)
const WIGGLE_PAD = 32;
// a face's border (wm.css): the line that wiggles
const FACE_BORDER = 2;
// a floating face's corners, as a picture (wm.css)
const TILE_ROUND = 10;
let stillMotion = null;

/**
 * their sound's waveform, all the way round their floating face (in its
 * picture's box): its border, bumping out from where it is, as soon as
 * there's sound, and while `props.speaking`. behind the face, so still it's
 * the border. not with reduced motion (the ring's shown then, as elsewhere)
 */
function Wiggle(props) {
  const canvas = document.createElement("canvas");
  canvas.className = "patchwork-call-wiggle";
  canvas.setAttribute("aria-hidden", "true");
  stillMotion ??= matchMedia("(prefers-reduced-motion: reduce)");
  let frame = requestAnimationFrame(draw);
  onCleanup(() => cancelAnimationFrame(frame));
  // how much it's shown (0 to 1), and whether there's anything to clear
  let shown = 0;
  let drawn = false;
  let samples = null;
  let loudest = 0;
  let heardAt = -Infinity;
  let colour = null;
  let colourAt = -Infinity;

  function draw(now) {
    frame = requestAnimationFrame(draw);
    const analyser = !stillMotion.matches && hearing(props.id);
    if (analyser) {
      if (samples?.length !== analyser.fftSize) samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      if (Math.sqrt(sum / samples.length) >= WIGGLE_HEARD) heardAt = now;
    }
    const wanted = !!analyser && (now - heardAt < WIGGLE_HOLD || !!props.speaking);
    shown += ((wanted ? 1 : 0) - shown) * (wanted ? 0.6 : 0.3);
    if (shown < 0.01 && !drawn) return;
    const picture = canvas.parentElement;
    const face = picture?.querySelector(".patchwork-call-face");
    if (!face) return;
    const g = canvas.getContext("2d");
    const dpr = devicePixelRatio || 1;
    const width = picture.offsetWidth + 2 * WIGGLE_PAD;
    const height = picture.offsetHeight + 2 * WIGGLE_PAD;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    drawn = false;
    if (shown < 0.01 || !analyser) return;

    const heard = louder(ringWave(samples, WIGGLE_POINTS, WIGGLE_SPAN), loudest);
    loudest = heard.loudest;
    // the face's box, and its corners: between a picture's and a circle's
    // as its width goes from the whole picture to round (wm.css)
    const w = face.offsetWidth;
    const h = face.offsetHeight;
    const round = Math.max(0, Math.min(1, (picture.offsetWidth - w) / (picture.offsetWidth * 0.25)));
    const r = TILE_ROUND + (Math.min(w, h) / 2 - TILE_ROUND) * round;
    // out from the middle of the border, either way of the sound as out
    const swing = Math.max(4, Math.min(9, Math.min(w, h) * 0.07)) * shown;
    const points = wiggle(w, h, r, heard.values.map(Math.abs), -FACE_BORDER / 2, swing);

    if (now - colourAt > 500) {
      colour = getComputedStyle(face).borderTopColor;
      colourAt = now;
    }
    g.translate(WIGGLE_PAD + face.offsetLeft + w / 2, WIGGLE_PAD + face.offsetTop + h / 2);
    g.beginPath();
    g.moveTo(...points[0]);
    for (const point of points) g.lineTo(...point);
    g.closePath();
    g.strokeStyle = colour;
    g.globalAlpha = shown;
    g.lineWidth = FACE_BORDER;
    g.lineJoin = "round";
    g.stroke();
    g.globalAlpha = 1;
    drawn = true;
  }
  return canvas;
}

/**
 * everyone's faces, floating over everything, each where you put it and the
 * size you made it (to start with, near `props.area`, the stage's box):
 * dragged to move, and by its corner to size. each is a
 * circle centred on their face, or, double clicked, the picture's own shape
 * (4:3), none of it cut off (and double clicked again, a circle)
 */
export function CallFloating(props) {
  // you too, last: by id, so each keeps its place as people come and go.
  // not the ones put away (dragged out of the call bar, they're back)
  const ids = createMemo(() =>
    [...call.peers().map((peer) => peer.id), "me"].filter((id) => !call.settings.floating[call.floatKey(id)]?.hidden),
  );
  // (in the sidebar, but nothing's showing the sidebar's: floating meanwhile)
  return html`<${Show} when=${() => call.get() && (call.mode() === "floating" || !call.videoShowing())}>
    <div class="patchwork-call-floating" popover="manual" ref=${onTop}>
      <${For} each=${ids}>
        ${(id, index) => {
          const mine = id === "me";
          const peer = () => (mine ? null : call.peers().find((peer) => peer.id === id));
          const key = () => call.floatKey(id);
          const name = () => (mine ? "you" : peer()?.name);
          const muted = () => (mine ? !call.get()?.mic : !peer()?.mic);
          const at = () => ({ ...startAt(index(), key(), props.area), ...call.settings.floating[key()] });
          let float;
          // what's being done to it: {sizing, dx, dy (or the width it was), at}
          let dragging = null;
          function onPointerDown(event) {
            if (event.button !== 0 || event.target.closest(".patchwork-call-float-close")) return;
            const box = float.getBoundingClientRect();
            const sizing = !!event.target.closest(".patchwork-call-size");
            dragging = sizing
              ? { sizing, x: event.clientX, width: at().width, at: at() }
              : { sizing, dx: event.clientX - box.left, dy: event.clientY - box.top, at: at() };
            float.setPointerCapture(event.pointerId);
            event.preventDefault();
          }
          function onPointerMove(event) {
            if (!dragging) return;
            if (dragging.sizing) {
              const width = Math.round(Math.max(FLOAT_MIN, Math.min(FLOAT_MAX, dragging.width + event.clientX - dragging.x)));
              dragging.at = { ...dragging.at, width };
              Object.assign(float.style, { ...inWindow(dragging.at), width: `${width}px` });
              return;
            }
            const x = Math.max(0, Math.min(1, (event.clientX - dragging.dx) / innerWidth));
            const y = Math.max(0, Math.min(1, (event.clientY - dragging.dy) / innerHeight));
            dragging.at = { ...dragging.at, x, y };
            Object.assign(float.style, inWindow(dragging.at));
          }
          function onPointerUp() {
            if (dragging) setFloating(key(), dragging.at);
            dragging = null;
          }
          const shape = () => (at().shape === "tile" ? "tile" : "round");
          return html`<div
            class="patchwork-call-float"
            data-shape=${shape}
            data-mine=${mine ? "" : undefined}
            data-staged=${() => (call.stage() && (mine || call.stage() === id) ? "" : undefined)}
            onDblClick=${() => setFloating(key(), { ...at(), shape: shape() === "round" ? "tile" : "round" })}
            ref=${(el) => {
              float = el;
              // once it's where it goes
              requestAnimationFrame(() => float.isConnected && arrive(float, id, key(), index()));
            }}
            style=${() => ({ ...inWindow(at()), width: `${at().width}px` })}
            onPointerDown=${onPointerDown}
            onPointerMove=${onPointerMove}
            onPointerUp=${onPointerUp}
            onPointerCancel=${onPointerUp}
          >
            <span class="patchwork-call-float-picture">
              <${Wiggle} id=${id} speaking=${() => (mine ? call.get()?.speaking : peer()?.speaking)} />
              <${Face} id=${id} shape="tile" muted=${false} />
              <span class="patchwork-call-size" title="drag to size"></span>
            </span>
            <span class="patchwork-call-float-name">
              <button
                class="patchwork-call-float-close"
                aria-label=${() => `minimise ${mine ? "your face" : `${name()}'s face`}`}
                title="minimise to the call bar (click them there, or drag them out, to have them back)"
                onClick=${() => minimise(float, id, () => hideFloating(key()))}
                onDblClick=${(event) => event.stopPropagation()}
              >
                ${icon("minimise", 11)}
              </button>
              ${name}
              <${Show} when=${muted}>
                <span class="patchwork-call-float-muted" aria-label="muted">${icon("mic-off", 10)}</span>
              <//>
            </span>
          </div>`;
        }}
      <//>
    </div>
  <//>`;
}

// a face dragged out (of the call bar) and let go somewhere else: their
// floating face is back, there. only while faces are floating. from the
// press, the whole window's listened to (a little face is soon left behind
// by the pointer), and the browser's own dragging is kept out of it.
// returns the handler for the press, and whether what just happened was a
// drag (so it's not a click too)
const DRAG_FROM = 5;
const GHOST_SIZE = 56;
function dragOut(id) {
  let dragged = false;
  function onPointerDown(event) {
    if (event.button !== 0 || call.mode() !== "floating") return;
    const from = event.target.closest("[data-call-face]");
    if (!from) return;
    // no text selected, no picture dragged by the browser
    event.preventDefault();
    dragged = false;
    const start = { x: event.clientX, y: event.clientY };
    let ghost = null;
    const move = (moved) => {
      if (moved.pointerId !== event.pointerId) return;
      if (!ghost) {
        if (Math.hypot(moved.clientX - start.x, moved.clientY - start.y) < DRAG_FROM) return;
        ghost = ghostOf(from.querySelector(".patchwork-call-face"));
      }
      ghost.style.left = `${moved.clientX}px`;
      ghost.style.top = `${moved.clientY}px`;
    };
    const stop = () => {
      removeEventListener("pointermove", move, true);
      removeEventListener("pointerup", up, true);
      removeEventListener("pointercancel", cancel, true);
      ghost?.remove();
    };
    const cancel = (ended) => {
      if (ended.pointerId === event.pointerId) stop();
    };
    const up = (ended) => {
      if (ended.pointerId !== event.pointerId) return;
      const was = !!ghost;
      stop();
      if (!was) return;
      dragged = true;
      // let go back over the call bar: never mind
      if (from.closest(".patchwork-call-panel")?.contains(document.elementFromPoint(ended.clientX, ended.clientY))) return;
      const key = call.floatKey(id);
      const width = call.settings.floating[key]?.width ?? (key === "me" ? MY_WIDTH : THEIR_WIDTH);
      dropped.add(key);
      showFloating(key, {
        x: Math.max(0, (ended.clientX - width / 2) / innerWidth),
        y: Math.max(0, (ended.clientY - (width * 0.75) / 2) / innerHeight),
        width,
      });
    };
    addEventListener("pointermove", move, true);
    addEventListener("pointerup", up, true);
    addEventListener("pointercancel", cancel, true);
  }
  return {
    onPointerDown,
    // (once: the click after a drag)
    wasDrag: () => {
      const was = dragged;
      dragged = false;
      return was;
    },
  };
}

// what's dragged: a copy of the face, pictures and all, under the pointer.
// its look is its own, so nothing it's dragged over or out of shapes it
function ghostOf(face) {
  const ghost = face.cloneNode(true);
  const video = face.querySelector("video");
  const copy = ghost.querySelector("video");
  if (video && copy) {
    copy.srcObject = video.srcObject;
    copy.muted = true;
    copy.play().catch(() => {});
  }
  ghost.classList.add("patchwork-call-ghost");
  Object.assign(ghost.style, {
    position: "fixed",
    zIndex: "2147483000",
    width: `${GHOST_SIZE}px`,
    height: `${GHOST_SIZE}px`,
    translate: "-50% -50%",
    pointerEvents: "none",
    margin: "0",
  });
  ghost.style.setProperty("--call-face-size", `${GHOST_SIZE}px`);
  document.body.append(ghost);
  return ghost;
}

// someone minimised (floating, put away): their floating face back where it
// was, out of the call bar. whether they were
function restore(id) {
  const key = call.floatKey(id);
  if (call.mode() !== "floating" || !call.settings.floating[key]?.hidden) return false;
  showFloating(key, {});
  return true;
}

/**
 * `props.id`'s face (props.children), to drag out of where it is into a
 * floating face, or, minimised, click to have it back
 */
export function DragOut(props) {
  const drag = dragOut(props.id);
  return html`<button
    type="button"
    class="patchwork-call-drag patchwork-call-stage-button"
    aria-label=${() => (props.id === "me" ? "restore your floating face" : "restore floating face")}
    data-call-face=${() => props.id}
    title=${() => (call.mode() === "floating" ? "drag out to float (minimised: click to have it back)" : undefined)}
    onPointerDown=${drag.onPointerDown}
    onDragStart=${(event) => event.preventDefault()}
    onClick=${() => !drag.wasDrag() && restore(props.id)}
  >
    ${props.children}
  </button>`;
}

/**
 * a face to click to fill the panes with them (again: the panes back), or,
 * floating, drag out to float, and minimised, click to have back where it
 * was. `props.id`; the rest's what's in it
 */
export function StageButton(props) {
  const drag = dragOut(props.id);
  return html`<button
    class=${() => `patchwork-call-stage-button ${props.class ?? ""}`}
    data-call-face=${() => props.id}
    data-staged=${() => (call.stage() === props.id ? "" : undefined)}
    data-arriving=${props.arriving}
    aria-pressed=${() => String(call.stage() === props.id)}
    title=${() =>
      call.stage() === props.id
        ? "back to the panes"
        : call.mode() === "floating"
          ? "fill the panes with them (or drag out to float)"
          : "fill the panes with them"}
    onPointerDown=${drag.onPointerDown}
    onDragStart=${(event) => event.preventDefault()}
    onClick=${() => !drag.wasDrag() && !restore(props.id) && toggleStage(props.id)}
  >
    ${props.children}
  </button>`;
}

/**
 * everyone's faces, for a sidebar, yours last: big while there are few, two
 * across when there are more, and past that a list, whoever spoke last at
 * the top. one clicked fills the box, you in its corner; clicked again, all
 * of them
 */
export function CallTiles() {
  const [focus, setFocus] = createSignal(null);
  const focused = () => (focus() && call.peers().some((peer) => peer.id === focus()) ? focus() : null);
  const count = () => call.peers().length + 1;
  const layout = () => tilesFor(count());
  const peers = createMemo(() => {
    const list = call.peers();
    if (layout() !== "chips") return list;
    return [...list].sort((a, b) => (b.speaking ? 1 : 0) - (a.speaking ? 1 : 0) || (b.spoke ?? 0) - (a.spoke ?? 0));
  });
  const name = (id) => call.peers().find((peer) => peer.id === id)?.name;

  const Focused = () => html`<div class="patchwork-call-tiles" data-layout="focus">
    <button class="patchwork-call-focus" title="everyone again" onClick=${() => setFocus(null)}>
      <${Show} when=${focused} keyed>${(id) => html`<${Picture} id=${id} />`}<//>
      <span class="patchwork-call-focus-name">${() => name(focused())}</span>
      <span class="patchwork-call-focus-me"><${Face} id="me" shape="tile" title=${false} /></span>
    </button>
  </div>`;

  return html`<${Show} when=${focused} fallback=${html`<div class="patchwork-call-tiles" data-layout=${layout}>
    <${For} each=${peers}>
      ${(peer) => html`<button
        class="patchwork-call-stage-button patchwork-call-tile"
        title="fill the box with them"
        onClick=${() => setFocus(peer.id)}
      >
        <${Show}
          when=${() => layout() !== "chips"}
          fallback=${html`<${Face} id=${peer.id} size=${28} title=${false} />`}
        >
          <${Face} id=${peer.id} shape="tile" title=${false} />
        <//>
        <span class="patchwork-call-tile-name">${() => peer.name}</span>
      </button>`}
    <//>
    <${Show} when=${() => call.get()}>
      <div class="patchwork-call-tile" data-mine="">
        <${Show}
          when=${() => layout() !== "chips"}
          fallback=${html`<${Face} id="me" size=${28} title=${false} />`}
        >
          <${Face} id="me" shape="tile" title=${false} />
        <//>
        <span class="patchwork-call-tile-name">you</span>
      </div>
    <//>
  </div>`}>
    ${Focused}
  <//>`;
}

/**
 * whoever's been clicked (call.stage()), filling `props.area` (the
 * stage's box, or else the window), with you in its corner. double clicked,
 * it fills the screen, you a little bigger; escape, or its ×, puts it away
 */
export function CallStage(props) {
  let stage;
  const id = () => call.stage();
  const person = () => call.peers().find((peer) => peer.id === id());

  // the whole screen, while it's wanted, and not once it's left (escape)
  createEffect(() => {
    // (read first: it's what this runs again for)
    const full = call.full();
    id();
    if (!stage?.isConnected) return;
    if (full && document.fullscreenElement !== stage) {
      stage.requestFullscreen?.().catch(() => setFull(false));
    } else if (!full && document.fullscreenElement === stage) {
      document.exitFullscreen().catch(() => {});
    }
  });
  const onFullscreen = () => {
    if (call.full() && document.fullscreenElement !== stage) setFull(false);
  };
  const onKey = (event) => {
    if (event.key === "Escape" && id() && !document.fullscreenElement) closeStage();
  };
  document.addEventListener("fullscreenchange", onFullscreen);
  document.addEventListener("keydown", onKey);
  onCleanup(() => {
    document.removeEventListener("fullscreenchange", onFullscreen);
    document.removeEventListener("keydown", onKey);
    if (stage && document.fullscreenElement === stage) document.exitFullscreen().catch(() => {});
  });

  return html`<${Show} when=${id}>
    <div
      class="patchwork-call-stage"
      popover="manual"
      ref=${(el) => {
        stage = el;
        onTop(el, () => raise(el.closest(".patchwork-call")?.querySelector(".patchwork-call-floating")));
      }}
      style=${() => boxStyle(props.area)}
      onDblClick=${() => setFull(!call.full())}
      title="double click: the whole screen"
    >
      <${Show} when=${id} keyed>
        ${(staged) => html`<${Picture} id=${staged} />`}
      <//>
      <span class="patchwork-call-stage-name">
        ${() => (call.screen(id()) ? `${person()?.name}'s screen` : person()?.name)}
        <${Show} when=${() => person() && !person().mic}>${icon("mic-off", 12)}<//>
      </span>
      <button
        class="patchwork-call-stage-close"
        aria-label="back to the panes"
        title="back to the panes (escape)"
        onClick=${closeStage}
        onDblClick=${(event) => event.stopPropagation()}
      >
        ${icon("close", 14)}
      </button>
      <span class="patchwork-call-stage-me">
        <${Face} id="me" shape="tile" title=${false} />
      </span>
    </div>
  <//>`;
}
