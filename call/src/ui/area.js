// where the stage goes: the first element under the provider a frame has
// marked data-call-stage (threepane's main area, lattice's panes), as a box
// on screen, followed as it moves and changes size. null where there's none:
// the stage fills the window then
import { createSignal, onCleanup } from "solid-js";

const same = (a, b) =>
  a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

/** the box of the stage's area under `root`, or null (in a reactive scope: it's let go on cleanup) */
export function stageArea(root) {
  const [box, setBox] = createSignal(null, { equals: same });
  let marked = null;
  const sizes = new ResizeObserver(() => measure());

  function measure() {
    if (!marked?.isConnected) return setBox(null);
    const { left, top, width, height } = marked.getBoundingClientRect();
    setBox({ left, top, width, height });
  }

  function find() {
    const now = root.querySelector("[data-call-stage]");
    if (now !== marked) {
      if (marked) sizes.unobserve(marked);
      marked = now;
      if (marked) sizes.observe(marked);
    }
    measure();
  }

  const changes = new MutationObserver(find);
  changes.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-call-stage"] });
  addEventListener("resize", measure);
  addEventListener("scroll", measure, true);
  find();

  onCleanup(() => {
    changes.disconnect();
    sizes.disconnect();
    removeEventListener("resize", measure);
    removeEventListener("scroll", measure, true);
  });
  return box;
}
