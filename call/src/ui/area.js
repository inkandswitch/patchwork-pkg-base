// where the stage goes: the first element under the provider a frame has
// marked data-call-stage (threepane's main area, lattice's panes), as a box
// on screen, followed as it moves and changes size. null where there's none:
// the stage fills the window then. only looked at while `active()` (you're in
// a call): the frame's changes cost nothing otherwise, and while it's found
// it isn't looked for again. it's measured once a frame at most
import { createEffect, createSignal, onCleanup } from "solid-js";

const same = (a, b) =>
  a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

/** the box of the stage's area under `root`, or null (in a reactive scope: it's let go on cleanup) */
export function stageArea(root, active = () => true) {
  const [box, setBox] = createSignal(null, { equals: same });

  createEffect(() => {
    if (!active()) return setBox(null);
    let marked = null;
    let frame = 0;
    const sizes = new ResizeObserver(() => soon());

    function measure() {
      frame = 0;
      if (!marked?.isConnected) return setBox(null);
      const { left, top, width, height } = marked.getBoundingClientRect();
      setBox({ left, top, width, height });
    }
    function soon() {
      frame ||= requestAnimationFrame(measure);
    }

    function find() {
      if (marked?.isConnected && marked.hasAttribute("data-call-stage")) return;
      const now = root.querySelector("[data-call-stage]");
      if (marked) sizes.unobserve(marked);
      marked = now;
      if (marked) sizes.observe(marked);
      soon();
    }

    const changes = new MutationObserver(find);
    changes.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-call-stage"] });
    addEventListener("resize", soon);
    addEventListener("scroll", soon, true);
    find();

    onCleanup(() => {
      cancelAnimationFrame(frame);
      changes.disconnect();
      sizes.disconnect();
      removeEventListener("resize", soon);
      removeEventListener("scroll", soon, true);
    });
  });
  return box;
}
