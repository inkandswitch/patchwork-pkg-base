// one person's face in your call, for anywhere: lattice puts one on each
// cursor. who it's of is said on its element, as attributes: `peer` (their
// tab, as presence knows it) and/or `contact` (who they are), `size` (px),
// and `no-title` to leave their name off it (a cursor says it already).
// nobody in your call by those, and it's nothing
import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import html from "solid-js/html";
import { call } from "./engine/call.js";
import { Face } from "./ui/ui.js";
import "./ui/styles.css";

const ASKS = ["peer", "contact", "size", "no-title"];

export function CallFace(element) {
  const read = () => ({
    peer: element.getAttribute("peer") ?? "",
    contact: element.getAttribute("contact") ?? "",
    size: Number(element.getAttribute("size")) || undefined,
    title: !element.hasAttribute("no-title"),
  });
  const [asked, setAsked] = createSignal(read());
  const watching = new MutationObserver(() => setAsked(read()));
  watching.observe(element, { attributes: true, attributeFilter: ASKS });

  const id = () => {
    if (!call.get()) return null;
    const { peer, contact } = asked();
    return call.find({ peer, contact })?.id ?? null;
  };
  const dispose = render(
    () => html`<${Show} when=${id} keyed>
      ${(them) => html`<${Face} id=${them} size=${() => asked().size} title=${() => asked().title} />`}
    <//>`,
    element,
  );
  return () => {
    watching.disconnect();
    dispose();
  };
}
