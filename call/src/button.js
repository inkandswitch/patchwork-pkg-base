// the call button, for any doc's title bar: call everyone who has it open,
// join the call that's on it, or hang up. it knows the call only by asking
// the provider (protocol.js), so it works wherever its title bar is. with
// no provider to ask, it's nothing
import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import html from "solid-js/html";
import { subscribe } from "@inkandswitch/patchwork-providers";
import { CALL, CALL_EVENT } from "./protocol-names.js";
import { icon } from "./ui/icons.js";
import "./ui/styles.css";

const PROVIDER = "call-provider";
const LABELS = { call: "call everyone here", join: "join the call", here: "hang up" };

export default function CallDoctitleButton(handle, element) {
  // the doc the frame has open: the view's own url (the handle may be a
  // draft's, presenting it)
  const url = element.closest?.("patchwork-view")?.getAttribute("doc-url") ?? handle.url;
  const [room, setRoom] = createSignal(null);
  let unsubscribe = subscribe(element, { type: CALL, url }, setRoom);
  // a provider that turns up after this asked (loaded late, or swapped in
  // anew) is asked again
  function again(event) {
    if (event.detail?.componentId !== PROVIDER) return;
    unsubscribe();
    unsubscribe = subscribe(element, { type: CALL, url }, setRoom);
  }
  addEventListener("patchwork:mounted", again);

  const state = () => (room()?.here ? "here" : room()?.others > 0 ? "join" : "call");
  const send = (detail) => element.dispatchEvent(new CustomEvent(CALL_EVENT, { bubbles: true, composed: true, detail }));

  function press(event) {
    if (state() === "here") return send({ action: "hang-up" });
    const box = event.currentTarget.getBoundingClientRect();
    send({ action: "ask", url, at: { x: box.left, y: box.bottom + 6 } });
  }

  const dispose = render(
    () => html`<${Show} when=${room}>
      <div class="patchwork-call-title">
        <button
          type="button"
          class="patchwork-call-button"
          data-state=${state}
          aria-label=${() => LABELS[state()]}
          title=${() => LABELS[state()]}
          onClick=${press}
        >
          ${() => icon(state() === "here" ? "hang-up" : "phone", 14)}
          <${Show} when=${() => state() === "join"}>
            <span class="patchwork-call-button-count">${() => room().others}</span>
          <//>
        </button>
      </div>
    <//>`,
    element,
  );
  return () => {
    removeEventListener("patchwork:mounted", again);
    unsubscribe();
    dispose();
  };
}
