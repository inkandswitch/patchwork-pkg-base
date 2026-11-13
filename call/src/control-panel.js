// the call's control panel, for a sidebar (threepane's left one, at the
// bottom; lattice's call bar, where this came from). the calls on screen
// you're not in, to join, each by where it is (which takes you there); and
// the one you're in: where it is, everyone in it, and your mic, camera,
// screen (where there's one to share) and hanging up. its menu says where
// faces go (floating, or in the sidebar where a frame can show them there),
// which mic and camera, and what's done about noise. with nothing to show,
// it takes no room (data-sidebar-size: none)
import { createEffect, createSignal, For, Show } from "solid-js";
import { render } from "solid-js/web";
import html from "solid-js/html";
import { openDocument } from "@inkandswitch/patchwork-elements";
import {
  FACES,
  call,
  canShare,
  devices,
  hangUp,
  join,
  setCamera,
  setDevice,
  setFaces,
  setMic,
  setNoise,
  startScreen,
  stopScreen,
} from "./engine/call.js";
import { download, DOWNLOAD_BYTES, NOISE } from "./engine/noise.js";
import { DragOut, Face, StageButton, names } from "./ui/ui.js";
import { scrollsAlong } from "./ui/along.js";
import { arrivals } from "./ui/arriving.js";
import { icon } from "./ui/icons.js";
import "./ui/styles.css";

export function CallControlPanel(element) {
  const showing = () => !!call.get() || call.rooms().length > 0 || !!call.problem();
  const dispose = render(() => {
    createEffect(() => (element.dataset.sidebarSize = showing() ? "fit" : "none"));
    return html`<${Panel} element=${element} />`;
  }, element);
  return () => {
    dispose();
    element.dataset.sidebarSize = "none";
  };
}

function Panel(props) {
  let menu;
  const [found, setFound] = createSignal({ audio: [], video: [] });
  const go = (url) => openDocument(props.element, url);

  async function openMenu(event) {
    if (menu.matches(":popover-open")) return menu.hidePopover();
    const box = event.currentTarget.getBoundingClientRect();
    menu.style.left = `${Math.max(8, box.left)}px`;
    menu.style.bottom = `${innerHeight - box.top + 4}px`;
    menu.style.top = "auto";
    // it grows up out of its button
    menu.style.transformOrigin = "0 100%";
    menu.showPopover();
    setFound(await devices());
  }

  // (choose takes the click, so it's a function, not a getter)
  function Choice(props) {
    return html`<button
      class="patchwork-call-menu-item patchwork-call-panel-choice"
      role="menuitemradio"
      aria-checked=${() => String(props.checked)}
      onClick=${(event) => {
        props.choose(event);
        menu.hidePopover();
      }}
    >
      ${() => props.label}
    </button>`;
  }

  function Devices(props) {
    const chosen = () => (props.kind === "audio" ? call.settings.mic : call.settings.camera);
    return html`<${Show} when=${() => found()[props.kind].length > 1}>
      <div class="patchwork-call-menu-heading">${props.kind === "audio" ? "mic" : "camera"}</div>
      <${For} each=${() => found()[props.kind]}>
        ${(device, at) =>
          html`<${Choice}
            label=${device.label}
            checked=${() => chosen() === device.id || (!chosen() && at() === 0)}
            choose=${(event) => setDevice(props.kind, device.id)}
          />`}
      <//>
    <//>`;
  }

  const In = () => {
    // someone joining while you're in it comes in (ui/arriving.js): not
    // whoever was there when you joined
    const arriving = arrivals();
    return html`<div class="patchwork-call-panel" role="group" aria-label="the call">
    <div class="patchwork-call-panel-head">
      <span class="patchwork-call-panel-phone">${icon("phone", 12)}</span>
      <button class="patchwork-call-panel-where" title="go to it" onClick=${() => go(call.get().room)}>
        ${() => (call.get().joining ? "joining…" : call.nameOf(call.get().room) || "a doc")}
      </button>
      <button
        class="patchwork-call-panel-button"
        title="faces, mic and camera"
        aria-label="faces, mic and camera"
        aria-haspopup="menu"
        onClick=${openMenu}
      >
        ${icon("chevron-down", 12)}
      </button>
    </div>
    <div class="patchwork-call-panel-row">
      <span class="patchwork-call-panel-faces" ref=${scrollsAlong}>
        <${DragOut} id="me"><${Face} id="me" size=${26} /><//>
        <${For} each=${call.peers}>
          ${(peer) => html`<${StageButton} id=${peer.id} class="patchwork-call-panel-face-button" arriving=${arriving(peer.id)}>
            <${Face} id=${peer.id} size=${26} />
          <//>`}
        <//>
      </span>
      <span class="patchwork-call-panel-buttons">
        <button
          class="patchwork-call-panel-button"
          data-off=${() => (call.get().mic ? undefined : "")}
          title=${() => (call.get().mic ? "mute" : "unmute")}
          aria-label=${() => (call.get().mic ? "mute" : "unmute")}
          onClick=${() => setMic(!call.get().mic)}
        >
          ${() => icon(call.get().mic ? "mic" : "mic-off", 14)}
        </button>
        <button
          class="patchwork-call-panel-button"
          data-off=${() => (call.get().camera ? undefined : "")}
          title=${() => (call.get().camera ? "camera off" : "camera on")}
          aria-label=${() => (call.get().camera ? "camera off" : "camera on")}
          onClick=${() => setCamera(!call.get().camera)}
        >
          ${() => icon(call.get().camera ? "video" : "video-off", 14)}
        </button>
        <${Show} when=${canShare}>
          <button
            class="patchwork-call-panel-button"
            data-on=${() => (call.get().screen ? "" : undefined)}
            aria-pressed=${() => String(!!call.get().screen)}
            title=${() => (call.get().screen ? "stop sharing your screen" : "share your screen")}
            aria-label=${() => (call.get().screen ? "stop sharing your screen" : "share your screen")}
            onClick=${() => (call.get().screen ? stopScreen() : startScreen())}
          >
            ${icon("screen", 14)}
          </button>
        <//>
        <button class="patchwork-call-panel-button patchwork-call-panel-hang-up" title="hang up" aria-label="hang up" onClick=${hangUp}>
          ${icon("hang-up", 14)}
        </button>
      </span>
    </div>
    <${Show} when=${() => call.get().problem}>
      <p class="patchwork-call-panel-problem">${() => call.get().problem}</p>
    <//>
    <${Show} when=${() => call.settings.noise === "deepfilternet" && download().state === "loading"}>
      <p class="patchwork-call-panel-note">
        getting DeepFilterNet ${() => Math.floor((download().got / download().total) * 100)}% · the browser's till then
      </p>
    <//>
    <${Show} when=${() => call.settings.noise === "deepfilternet" && download().state === "failed"}>
      <p class="patchwork-call-panel-problem">couldn't get DeepFilterNet (${() => download().problem}): the browser's for now</p>
    <//>
    <div class="patchwork-call-menu patchwork-call-panel-menu" popover="auto" role="menu" ref=${(el) => (menu = el)}>
      <div class="patchwork-call-menu-heading">faces</div>
      <${For} each=${() => FACES.filter(([id]) => id !== "sidebar" || call.canShowVideo())}>
        ${([id, label]) =>
          html`<${Choice}
            label=${label}
            checked=${() => call.mode() === id}
            choose=${(event) => setFaces(id)}
          />`}
      <//>
      <${Devices} kind="audio" />
      <div class="patchwork-call-menu-heading">noise</div>
      <${For} each=${NOISE}>
        ${([id, label]) =>
          html`<${Choice}
            label=${() => (id === "deepfilternet" ? `${label} ${deepFilterNote()}` : label)}
            checked=${() => call.settings.noise === id}
            choose=${(event) => setNoise(id)}
          />`}
      <//>
      <${Devices} kind="video" />
    </div>
  </div>`;
  };

  // DeepFilterNet's download, in its line of the menu and under the call
  // while it's going: what it is till it's here, how far it's got, or why not
  const megabytes = (bytes) => `${Math.round(bytes / 1024 / 1024)}MB`;
  function deepFilterNote() {
    const { state, got, total } = download();
    if (state === "loading") return `· downloading ${Math.floor((got / total) * 100)}%`;
    if (state === "failed") return "· couldn't download it";
    if (state === "ready") return "";
    return `· AI, ${megabytes(DOWNLOAD_BYTES)} once`;
  }

  // a call on screen that you're not in: where (which takes you there), who,
  // and joining it, leaving the one you're in if you are
  // (by url, so a row stays as it is while who's on it is heard again)
  const On = (url) => {
    const room = () => call.rooms().find((room) => room.url === url) ?? { url, name: "", others: [] };
    return html`<div class="patchwork-call-panel" data-on="">
    <div class="patchwork-call-panel-head">
      <span class="patchwork-call-panel-phone">${icon("phone", 12)}</span>
      <button class="patchwork-call-panel-where" title="go to it" onClick=${() => go(url)}>
        ${() => room().name || "a doc"}
      </button>
    </div>
    <p class="patchwork-call-panel-who">
      ${() => `${names([...new Set(room().others.map((person) => person.who.name))])} on a call`}
    </p>
    <div class="patchwork-call-panel-row">
      <button class="patchwork-call-panel-join" onClick=${() => join(url, { video: true })}>
        ${icon("video", 12)} video on
      </button>
      <button class="patchwork-call-panel-join" data-quiet="" onClick=${() => join(url, { video: false })}>
        ${icon("mic", 12)} just voice
      </button>
    </div>
    <${Show} when=${() => call.get()}>
      <p class="patchwork-call-panel-note">leaves the call in ${() => call.nameOf(call.get().room) || "another doc"}</p>
    <//>
  </div>`;
  };

  return html`
    <${For} each=${() => call.rooms().map((room) => room.url)}>${On}<//>
    <${Show} when=${() => !call.get() && call.problem()}>
      <p class="patchwork-call-panel-problem">${() => call.problem()}</p>
    <//>
    <${Show} when=${() => !!call.get()}>${In}<//>
  `;
}
