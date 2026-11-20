// the call's control panel, for a sidebar (threepane's left one, at the
// bottom; lattice's call bar, where this came from). the calls on screen
// you're not in, to join, each by where it is (which takes you there); and
// the one you're in: where it is, everyone in it, and your mic, camera,
// screen (where there's one to share) and hanging up, and picture in picture
// (where there's that: ui/pip.js). its menu says where
// faces go (floating, or in the sidebar where a frame can show them there),
// which mic and camera, what's done about noise, and how much video's sent
// and wanted (less, on a bad network or a low battery). with nothing to show,
// it takes no room (data-sidebar-size: none). the menu's a list of each
// setting as it is, and each opens to its choices (any number of mics and
// cameras), with a way back
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
  setPrefer,
  setQuality,
  startScreen,
  stopScreen,
} from "./engine/call.js";
import { download, DOWNLOAD_BYTES, NOISE } from "./engine/noise.js";
import { PREFER, QUALITY } from "./engine/sizes.js";
import { DragOut, Face, StageButton, names } from "./ui/ui.js";
import { scrollsAlong } from "./ui/along.js";
import { arrivals } from "./ui/arriving.js";
import { icon } from "./ui/icons.js";
import { canPip, closePip, openPip, pipOpen } from "./ui/pip.js";
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
  // which of the menu's submenus is open (PAGES), or null for the list of them
  const [page, setPage] = createSignal(null);
  // how it came: "into" a submenu, "back" out of one (it comes in from that
  // side), or null, as the menu opens (it's there)
  const [came, setCame] = createSignal(null);
  const openPage = (id, how = id === null ? "back" : "into") => {
    setCame(how);
    setPage(id);
  };
  const go = (url) => openDocument(props.element, url);

  async function openMenu(event) {
    if (menu.matches(":popover-open")) return menu.hidePopover();
    const box = event.currentTarget.getBoundingClientRect();
    menu.style.left = `${Math.max(8, box.left)}px`;
    menu.style.bottom = `${innerHeight - box.top + 4}px`;
    menu.style.top = "auto";
    // all of it on screen, however long it is: scrolled, if not
    menu.style.maxHeight = `${Math.max(120, box.top - 12)}px`;
    // it grows up out of its button
    menu.style.transformOrigin = "0 100%";
    openPage(null, null);
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

  // the mic (`kind` "audio") or camera chosen: its id, or the first's
  const chosenDevice = (kind) => {
    const list = found()[kind];
    const id = kind === "audio" ? call.settings.mic : call.settings.camera;
    return list.find((device) => device.id === id) ?? list[0] ?? null;
  };

  function Devices(props) {
    return html`<${For} each=${() => found()[props.kind]}>
      ${(device) =>
        html`<${Choice}
          label=${device.label}
          checked=${() => chosenDevice(props.kind)?.id === device.id}
          choose=${(event) => setDevice(props.kind, device.id)}
        />`}
    <//>`;
  }

  // a row of choices (`props.choices`: [id, label]), one chosen
  // (`props.chosen`: a getter, as html makes a function of none),
  // `props.choose(id)` to choose: it stays open, to try another
  function Segments(props) {
    return html`<div class="patchwork-call-menu-heading">${props.heading}</div>
      <div class="patchwork-call-menu-segments" role="group" aria-label=${props.heading}>
        <${For} each=${props.choices}>
          ${([id, label]) =>
            html`<button
              class="patchwork-call-menu-segment"
              role="menuitemradio"
              aria-checked=${() => String(props.chosen === id)}
              onClick=${() => props.choose(id)}
            >
              ${label}
            </button>`}
        <//>
      </div>`;
  }

  // how much video's sent (`props.which`: "send"), or wanted ("receive")
  const Quality = (props) =>
    html`<${Segments}
      heading=${props.heading}
      choices=${QUALITY}
      chosen=${() => call.settings[props.which] ?? "full"}
      choose=${(id) => setQuality(props.which, id)}
    />`;

  const label = (list, id) => list.find(([known]) => known === id)?.[1] ?? "";
  const facesChoices = () => FACES.filter(([id]) => id !== "sidebar" || call.canShowVideo());

  // the menu's submenus: what each is, what it's set to now (on its row in
  // the list), whether it's there at all, and its choices
  const PAGES = [
    {
      id: "faces",
      title: "faces",
      now: () => label(FACES, call.mode()),
      shown: () => true,
      body: () => html`<${For} each=${facesChoices}>
        ${([id, label]) => html`<${Choice} label=${label} checked=${() => call.mode() === id} choose=${(event) => setFaces(id)} />`}
      <//>`,
    },
    {
      id: "mic",
      title: "mic",
      now: () => chosenDevice("audio")?.label ?? "",
      shown: () => found().audio.length > 0,
      body: () => html`<${Devices} kind="audio" />`,
    },
    {
      id: "camera",
      title: "camera",
      now: () => chosenDevice("video")?.label ?? "",
      shown: () => found().video.length > 0,
      body: () => html`<${Devices} kind="video" />`,
    },
    {
      id: "noise",
      title: "noise",
      now: () => label(NOISE, call.settings.noise),
      shown: () => true,
      body: () => html`<${For} each=${NOISE}>
        ${([id, label]) =>
          html`<${Choice}
            label=${() => (id === "deepfilternet" ? `${label} ${deepFilterNote()}` : label)}
            checked=${() => call.settings.noise === id}
            choose=${(event) => setNoise(id)}
          />`}
      <//>`,
    },
    {
      id: "quality",
      title: "video quality",
      now: () => {
        const send = call.settings.send ?? "full";
        const receive = call.settings.receive ?? "full";
        return send === receive ? send : `${send} out · ${receive} in`;
      },
      shown: () => true,
      body: () => html`<${Quality} which="send" heading="video you send" />
        <${Quality} which="receive" heading="video you get" />
        <${Segments}
          heading="when it's struggling, keep it"
          choices=${PREFER}
          chosen=${() => call.settings.prefer ?? "balanced"}
          choose=${(id) => setPrefer(id)}
        />
        <${Show} when=${() => call.controls().strain > 0}>
          <p class="patchwork-call-menu-note">this computer's struggling: capturing less till it isn't</p>
        <//>`,
    },
  ];

  // a submenu, or the list of them: the first thing in it has the focus, for
  // the keyboard
  const focusFirst = (el) =>
    queueMicrotask(() => {
      if (menu?.matches?.(":popover-open") && menu.contains(document.activeElement)) {
        el.querySelector("button")?.focus({ preventScroll: true });
      }
    });

  const Menu = () => html`<div
    class="patchwork-call-menu"
    popover="auto"
    role="menu"
    ref=${(el) => (menu = el)}
    onToggle=${(event) => event.newState === "closed" && openPage(null, null)}
  >
    <${Show}
      when=${() => PAGES.find((one) => one.id === page())}
      keyed=${true}
      fallback=${html`<div class="patchwork-call-menu-page" data-came=${came} ref=${focusFirst}>
        <${For} each=${() => PAGES.filter((one) => one.shown())}>
          ${(one) => html`<button
            class="patchwork-call-menu-item patchwork-call-menu-into"
            role="menuitem"
            aria-haspopup="menu"
            onClick=${() => openPage(one.id)}
          >
            <span class="patchwork-call-menu-into-title">${one.title}</span>
            <span class="patchwork-call-menu-into-now">${one.now}</span>
            ${icon("next", 12)}
          </button>`}
        <//>
      </div>`}
    >
      ${(one) => html`<div class="patchwork-call-menu-page" data-came=${came} ref=${focusFirst}>
        <button class="patchwork-call-menu-item patchwork-call-menu-back" onClick=${() => openPage(null)}>
          ${icon("back", 12)} ${one.title}
        </button>
        ${one.body()}
      </div>`}
    <//>
  </div>`;

  const In = () => {
    // someone joining while you're in it comes in (ui/arriving.js): not
    // whoever was there when you joined
    const arriving = arrivals();
    return html`<div class="patchwork-call-panel" role="group" aria-label="the call">
    <div class="patchwork-call-panel-head">
      <span class="patchwork-call-panel-phone">${icon("phone", 12)}</span>
      <button class="patchwork-call-panel-where" title="go to it" onClick=${() => go(call.get()?.room)}>
        ${() => (call.get()?.joining ? "joining…" : call.nameOf(call.get()?.room) || "a doc")}
      </button>
      <${Show} when=${canPip}>
        <button
          class="patchwork-call-panel-button"
          data-on=${() => (pipOpen() ? "" : undefined)}
          aria-pressed=${() => String(pipOpen())}
          title=${() => (pipOpen() ? "close picture in picture" : "picture in picture: the call in a little window, over everything")}
          aria-label=${() => (pipOpen() ? "close picture in picture" : "picture in picture")}
          onClick=${() => (pipOpen() ? closePip() : openPip({ from: props.element }))}
        >
          ${icon("pip", 12)}
        </button>
      <//>
      <button
        class="patchwork-call-panel-button"
        title="settings: faces, mic, camera, noise and video quality"
        aria-label="call settings"
        aria-haspopup="menu"
        onPointerDown=${(event) => {
          event.currentTarget.dataset.callMenuWasOpen = String(menu.matches(":popover-open"));
        }}
        onClick=${(event) => {
          const button = event.currentTarget;
          const dismiss = event.detail > 0 && button.dataset.callMenuWasOpen === "true";
          delete button.dataset.callMenuWasOpen;
          if (dismiss) menu.hidePopover();
          else openMenu(event);
        }}
      >
        ${icon("cog", 12)}
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
          data-off=${() => (call.get()?.mic ? undefined : "")}
          title=${() => (call.get()?.mic ? "mute" : "unmute")}
          aria-label=${() => (call.get()?.mic ? "mute" : "unmute")}
          onClick=${() => setMic(!call.get()?.mic)}
        >
          ${() => icon(call.get()?.mic ? "mic" : "mic-off", 14)}
        </button>
        <button
          class="patchwork-call-panel-button"
          data-off=${() => (call.get()?.camera ? undefined : "")}
          title=${() => (call.get()?.camera ? "camera off" : "camera on")}
          aria-label=${() => (call.get()?.camera ? "camera off" : "camera on")}
          onClick=${() => setCamera(!call.get()?.camera)}
        >
          ${() => icon(call.get()?.camera ? "video" : "video-off", 14)}
        </button>
        <${Show} when=${canShare}>
          <button
            class="patchwork-call-panel-button"
            data-on=${() => (call.get()?.screen ? "" : undefined)}
            aria-pressed=${() => String(!!call.get()?.screen)}
            title=${() => (call.get()?.screen ? "stop sharing your screen" : "share your screen")}
            aria-label=${() => (call.get()?.screen ? "stop sharing your screen" : "share your screen")}
            onClick=${() => (call.get()?.screen ? stopScreen() : startScreen())}
          >
            ${icon("screen", 14)}
          </button>
        <//>
        <button class="patchwork-call-panel-button patchwork-call-panel-hang-up" title="hang up" aria-label="hang up" onClick=${hangUp}>
          ${icon("hang-up", 14)}
        </button>
      </span>
    </div>
    <${Show} when=${() => call.get()?.problem}>
      <p class="patchwork-call-panel-problem">${() => call.get()?.problem}</p>
    <//>
    <${Show} when=${() => call.settings.noise === "deepfilternet" && download().state === "loading"}>
      <p class="patchwork-call-panel-note">
        getting DeepFilterNet ${() => Math.floor((download().got / download().total) * 100)}% · the browser's till then
      </p>
    <//>
    <${Show} when=${() => call.settings.noise === "deepfilternet" && download().state === "failed"}>
      <p class="patchwork-call-panel-problem">couldn't get DeepFilterNet (${() => download().problem}): the browser's for now</p>
    <//>
    <${Menu} />
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
      <p class="patchwork-call-panel-note">leaves the call in ${() => call.nameOf(call.get()?.room) || "another doc"}</p>
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
