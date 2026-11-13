// the video: everyone's faces as tiles, for a frame's sidebar (threepane's
// right one, a tab; lattice's inspector). where faces go when they're "in
// the sidebar". out of a call, it says so
import { Show } from "solid-js";
import { render } from "solid-js/web";
import html from "solid-js/html";
import { call } from "./engine/call.js";
import { CallTiles } from "./ui/ui.js";
import "./ui/styles.css";

export function CallVideo(element) {
  return render(
    () => html`<div class="patchwork-call-video">
      <${Show} when=${() => call.get()} fallback=${html`<p class="patchwork-call-video-none">no call</p>`}>
        <${CallTiles} />
      <//>
    </div>`,
    element,
  );
}
