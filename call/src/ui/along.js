// a row of faces that's longer than it has room for (five people in a call,
// twenty): it scrolls sideways, and fades out at whichever end there's more
// past, so you can see there's more. data-more on it ("start", "end" or
// "both") is what its css fades by. a wheel's up and down scrolls it along
// too, while there's further to go that way (a mouse has no sideways)
import { onCleanup } from "solid-js";

// how far from an end still counts as at it
const SLACK = 1;
// the fade's width: a face brought into view clears it
const FADE = 16;

/** make `el` (a row, with its faces in it) scroll along. as a ref */
export function scrollsAlong(el) {
  el.classList.add("patchwork-call-along");

  function mark() {
    const room = el.scrollWidth - el.clientWidth;
    const start = el.scrollLeft > SLACK;
    const end = el.scrollLeft < room - SLACK;
    const more = start && end ? "both" : start ? "start" : end ? "end" : null;
    if (more) el.dataset.more = more;
    else delete el.dataset.more;
  }

  function onWheel(event) {
    if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    const room = el.scrollWidth - el.clientWidth;
    if (room <= 0) return;
    const by = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientWidth : 1);
    const to = Math.max(0, Math.min(room, el.scrollLeft + by));
    // at the end already: what's round it has the wheel
    if (Math.abs(to - el.scrollLeft) < SLACK) return;
    event.preventDefault();
    el.scrollLeft = to;
  }

  el.addEventListener("scroll", mark, { passive: true });
  el.addEventListener("wheel", onWheel, { passive: false });
  // its size changing, or someone coming or going
  const resized = new ResizeObserver(mark);
  resized.observe(el);
  const changed = new MutationObserver(mark);
  changed.observe(el, { childList: true });
  queueMicrotask(mark);

  onCleanup(() => {
    el.removeEventListener("scroll", mark);
    el.removeEventListener("wheel", onWheel);
    resized.disconnect();
    changed.disconnect();
  });
}

/** scroll whatever row `child` is in so it's in view, clear of the fade */
export function bringAlong(child) {
  const row = child?.closest(".patchwork-call-along");
  if (!row) return;
  const box = child.getBoundingClientRect();
  const on = row.getBoundingClientRect();
  if (box.left < on.left + FADE) row.scrollLeft -= on.left + FADE - box.left;
  else if (box.right > on.right - FADE) row.scrollLeft += box.right - (on.right - FADE);
}
