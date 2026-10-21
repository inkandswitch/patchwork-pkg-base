// The why inspector's button, pointer mode and card.
//
//   idle     → a "?" button in the tray
//   picking  → the whole window is a crosshair; whatever patchwork-view is under
//              the pointer gets an outline and a name tag. click to pick it,
//              Escape to stop.
//   card     → a card above the button says what you picked and what it sits
//              inside (a row of chips, outermost first). the outline stays on
//              the thing you're reading about; hovering a chip outlines that one.
//
// The outline, tag and card live in one top-layer popover on <body>, so they
// sit above everything in the frame (and the overlay never ends up inside the
// tray's stacking context).

import {
  describe,
  elementAt,
  labelOf,
  rectOf,
  shortHeads,
  shortUrl,
  viewsAround,
  watchMounts,
  type ViewInfo,
} from "./inspect.ts";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { packageName } from "./package-name.ts";
import { styles } from "./styles.ts";

interface HandleLike {
  heads(): readonly string[] | undefined;
  doc(): any;
  on(event: "change", cb: () => void): void;
  off(event: "change", cb: () => void): void;
}
interface RepoLike {
  find(url: any): Promise<HandleLike> | HandleLike;
}

type Mode = "idle" | "picking" | "card";

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

export function mountWhyInspector(
  element: HTMLElement,
  repo: RepoLike
): () => void {
  const stopWatching = watchMounts();

  // --- the button, in the tray ---------------------------------------------
  const buttonHost = h("span");
  const buttonRoot = buttonHost.attachShadow({ mode: "open" });
  const button = h(
    "button",
    {
      type: "button",
      class: "why-button",
      "aria-label": "What is this? Point at anything to see what it is",
      title: "What is this? Point at anything to see what it is",
      "aria-pressed": "false",
    },
    "?"
  );
  buttonRoot.append(h("style", {}, styles), button);
  element.append(buttonHost);

  // --- the layer: outline, tag, card ---------------------------------------
  const layer = h("div", { popover: "manual", "data-why-inspector": "" });
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    maxWidth: "none",
    maxHeight: "none",
    margin: "0",
    padding: "0",
    border: "0",
    background: "transparent",
    overflow: "visible",
    pointerEvents: "none",
    zIndex: "2147483646",
  });
  const layerRoot = layer.attachShadow({ mode: "open" });
  const catcher = h("div", { class: "catcher" });
  const outline = h("div", { class: "outline", hidden: "" });
  const tag = h("div", { class: "tag", hidden: "" });
  const card = h("section", {
    class: "card",
    role: "dialog",
    "aria-label": "What is this?",
    hidden: "",
  });
  layerRoot.append(h("style", {}, styles), catcher, outline, tag, card);
  document.body.append(layer);

  const showLayer = () => {
    if (typeof layer.showPopover === "function") {
      if (!layer.matches(":popover-open")) layer.showPopover();
    } else {
      layer.style.display = "block";
    }
  };
  const hideLayer = () => {
    if (typeof layer.hidePopover === "function") {
      if (layer.matches(":popover-open")) layer.hidePopover();
    } else {
      layer.style.display = "none";
    }
  };

  // --- state ---------------------------------------------------------------
  let mode: Mode = "idle";
  let chain: ViewInfo[] = [];
  let selected = -1;
  /** what the outline is drawn around right now */
  let outlined: Element | null = null;
  let frame = 0;
  let stopHeads: (() => void) | null = null;
  let lastPointer = { x: 0, y: 0 };
  /** history-view, opened from the card at a moment in time */
  let historyView: HTMLElement | null = null;

  function closeHistory() {
    historyView?.remove();
    historyView = null;
  }

  /**
   * Show the doc's history in the card, focused on `heads`. history-view lives
   * in the document (not our shadow root) so its own styles reach it; a <slot>
   * in the card puts it in the right place.
   */
  function openHistory(url: string, heads: readonly string[]): boolean {
    closeHistory();
    let installed = false;
    try {
      installed = !!getRegistry<any>("patchwork:component").get("history-view");
    } catch {
      installed = false;
    }
    if (!installed) return false;
    const view = document.createElement("patchwork-view");
    for (const [k, v] of Object.entries({
      component: "history-view",
      "doc-url": url,
      heads: heads.join(","),
      slot: "history",
      class: "why-history",
    })) view.setAttribute(k, v);
    Object.assign(view.style, {
      display: "block",
      height: "320px",
      overflow: "auto",
      marginTop: "8px",
      pointerEvents: "auto",
    });
    layer.append(view);
    historyView = view;
    return true;
  }

  function setMode(next: Mode) {
    mode = next;
    button.setAttribute("aria-pressed", String(next !== "idle"));
    catcher.classList.toggle("on", next === "picking");
    tag.hidden = next !== "picking";
    card.hidden = next !== "card";
    if (next === "idle") {
      outlined = null;
      outline.hidden = true;
      stopHeads?.();
      stopHeads = null;
      closeHistory();
      hideLayer();
      cancelAnimationFrame(frame);
      frame = 0;
    } else {
      showLayer();
      if (!frame) frame = requestAnimationFrame(follow);
    }
  }

  // Keep the outline on its element while things scroll, resize or animate.
  function follow() {
    frame = 0;
    if (mode === "idle") return;
    if (outlined?.isConnected) {
      const r = rectOf(outlined);
      outline.hidden = false;
      Object.assign(outline.style, {
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
    } else {
      outline.hidden = true;
    }
    frame = requestAnimationFrame(follow);
  }

  // --- picking ---------------------------------------------------------------
  const skipOwn = (el: Element) => el === layer || el === buttonHost;

  function viewsAtPointer(x: number, y: number): HTMLElement[] {
    return viewsAround(elementAt(x, y, skipOwn));
  }

  let tagFor: Element | null = null;
  function onPointerMove(event: PointerEvent) {
    lastPointer = { x: event.clientX, y: event.clientY };
    const views = viewsAtPointer(event.clientX, event.clientY);
    const target = views[views.length - 1] ?? null;
    outlined = target;
    placeTag(event.clientX, event.clientY);
    if (target === tagFor) return;
    tagFor = target;
    if (!target) {
      tag.textContent = "nothing from a plugin here";
      return;
    }
    const info = describe(target);
    tag.textContent = labelOf(info);
    if (info.importUrl) {
      const forTarget = target;
      void packageName(info.importUrl).then((name) => {
        if (tagFor === forTarget) tag.textContent = `${labelOf(info)} · ${name}`;
      });
    }
  }

  function placeTag(x: number, y: number) {
    const pad = 14;
    const w = tag.offsetWidth || 160;
    const left = Math.min(x + pad, window.innerWidth - w - 8);
    const top = y + pad + 24 > window.innerHeight ? y - pad - 24 : y + pad;
    tag.style.left = `${Math.max(8, left)}px`;
    tag.style.top = `${top}px`;
  }

  function onPick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const views = viewsAtPointer(event.clientX, event.clientY);
    if (!views.length) return;
    chain = views.map(describe);
    select(chain.length - 1);
    setMode("card");
    placeCard();
  }

  catcher.addEventListener("pointermove", onPointerMove);
  catcher.addEventListener("click", onPick);
  // a right click while pointing means "never mind"
  catcher.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    setMode("idle");
  });

  // --- the card ----------------------------------------------------------------
  function placeCard() {
    const b = button.getBoundingClientRect();
    card.style.left = `${Math.max(8, b.left)}px`;
    card.style.bottom = `${Math.max(8, window.innerHeight - b.top + 8)}px`;
  }

  function select(index: number) {
    selected = index;
    outlined = chain[index]?.element ?? null;
    renderCard();
  }

  function renderCard() {
    stopHeads?.();
    stopHeads = null;
    closeHistory();
    const info = chain[selected];

    const again = h("button", { type: "button", class: "text-button" }, "point again");
    again.addEventListener("click", () => {
      setMode("picking");
      outlined = null;
      tagFor = null;
      tag.textContent = "point at something";
      placeTag(lastPointer.x, lastPointer.y);
    });
    const close = h(
      "button",
      { type: "button", class: "close", "aria-label": "Close" },
      "×"
    );
    close.addEventListener("click", () => setMode("idle"));

    const chips = h("ol", { class: "chain", "aria-label": "What it sits inside, outermost first" });
    chain.forEach((view, i) => {
      const chip = h(
        "button",
        {
          type: "button",
          class: `chip chip--${view.kind}`,
          title: view.id ?? labelOf(view),
        },
        labelOf(view)
      );
      if (i === selected) chip.setAttribute("aria-current", "true");
      chip.addEventListener("click", () => select(i));
      chip.addEventListener("pointerenter", () => (outlined = view.element));
      chip.addEventListener("pointerleave", () => (outlined = chain[selected]?.element ?? null));
      chip.addEventListener("focus", () => (outlined = view.element));
      chip.addEventListener("blur", () => (outlined = chain[selected]?.element ?? null));
      chips.append(h("li", {}, chip));
    });

    card.replaceChildren(
      h("header", {}, h("strong", {}, "what is this?"), again, close),
      chips,
      info ? facts(info) : h("p", {}, "nothing picked"),
      h("slot", { name: "history" })
    );
  }

  function row(label: string, ...value: (Node | string)[]) {
    return [h("dt", {}, label), h("dd", {}, ...value)];
  }

  function copyButton(text: string, label: string, title: string) {
    const b = h("button", { type: "button", class: "copy", title }, label);
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        b.textContent = "copied";
      } catch {
        b.textContent = "couldn't copy";
      }
      setTimeout(() => (b.textContent = label), 1200);
    });
    return b;
  }

  function facts(info: ViewInfo): HTMLElement {
    const box = h("div", { class: "facts" });
    if (info.kind === "isolated") {
      box.append(
        h(
          "p",
          { class: "note" },
          "A sandboxed pane. The frame can't see inside it, so this is only what the frame handed it."
        )
      );
    }

    const dl = h("dl");
    const name =
      info.kind === "isolated"
        ? `${info.name ?? info.id ?? "a doc"}, in a sandbox`
        : labelOf(info);
    dl.append(...row("it's", h("strong", {}, name)));

    if (info.kind === "component") {
      dl.append(...row("component", h("code", {}, info.id ?? "?")));
    } else {
      const toolNote =
        info.toolSource === "default"
          ? " (the default for this kind of doc)"
          : info.toolSource === "unknown"
            ? info.kind === "isolated"
              ? " (whatever the pane picks by default)"
              : " (it picked a default before I was watching)"
            : "";
      dl.append(
        ...row("tool", info.id ? h("code", {}, info.id) : "not named", toolNote)
      );
    }

    if (info.missing) {
      dl.append(...row("from", h("span", { class: "warn" }, `nothing called “${info.id}” is installed`)));
    } else if (info.importUrl) {
      const from = h("span", { title: info.importUrl }, "…");
      void packageName(info.importUrl).then((name) => (from.textContent = name));
      dl.append(...row("from", from, " ", copyButton(info.importUrl, "copy url", info.importUrl)));
    }

    if (info.docUrl) {
      const what = h("span", {}, "…");
      const heads = h("code", { class: "heads" }, "…");
      dl.append(
        ...row("doc", what, " ", copyButton(info.docUrl, shortUrl(info.docUrl), info.docUrl)),
        ...row("at", heads)
      );
      void watchDoc(info.docUrl, what, heads);
    }

    box.append(dl);
    return box;
  }

  async function watchDoc(
    url: string,
    what: HTMLElement,
    headsEl: HTMLElement
  ) {
    const forSelected = selected;
    let handle: HandleLike;
    try {
      handle = await repo.find(url);
    } catch (error) {
      if (selected !== forSelected) return;
      what.textContent = "";
      what.append(h("span", { class: "warn" }, `couldn't open it: ${String((error as Error)?.message ?? error)}`));
      headsEl.textContent = "unknown";
      return;
    }
    if (selected !== forSelected || mode !== "card") return;

    let copyHeads: HTMLElement | null = null;
    const update = (changed: boolean) => {
      const doc = handle.doc();
      const type = doc?.["@patchwork"]?.type;
      const title =
        typeof doc?.title === "string" ? doc.title : typeof doc?.name === "string" ? doc.name : undefined;
      what.textContent = [type, title && `“${title}”`].filter(Boolean).join(" · ") || "a doc";
      const heads = handle.heads() ?? [];
      headsEl.textContent = shortHeads(heads);
      headsEl.title = heads.join("\n");
      const next = copyButton(JSON.stringify(heads), "copy heads", "copy the full heads");
      if (copyHeads) copyHeads.replaceWith(next);
      else headsEl.after(" ", next);
      copyHeads = next;
      if (changed) {
        headsEl.classList.remove("ticked");
        void headsEl.offsetWidth; // restart the animation
        headsEl.classList.add("ticked");
      }
    };
    update(false);

    // "show in history": history-view at the heads as they are right now. It
    // stays at that moment even if the doc moves on; the heads above keep ticking.
    const history = h("button", { type: "button", class: "text-button" }, "show in history");
    const historyNote = h("span", { class: "warn" });
    history.addEventListener("click", () => {
      if (historyView) {
        closeHistory();
        history.textContent = "show in history";
        return;
      }
      const heads = handle.heads() ?? [];
      if (openHistory(url, heads)) {
        history.textContent = `hide history (at ${shortHeads(heads.slice(0, 1))})`;
        historyNote.textContent = "";
      } else {
        historyNote.textContent = " History isn't installed, so I can't show it.";
      }
    });
    headsEl.parentElement?.append(h("br"), history, historyNote);

    const onChange = () => update(true);
    handle.on("change", onChange);
    stopHeads = () => handle.off("change", onChange);
  }

  // --- wiring ------------------------------------------------------------------
  button.addEventListener("click", () => {
    if (mode === "idle") {
      setMode("picking");
      tagFor = null;
      tag.textContent = "point at something";
      const b = button.getBoundingClientRect();
      placeTag(b.right, b.top - 40);
    } else {
      setMode("idle");
    }
  });

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && mode !== "idle") {
      event.stopPropagation();
      setMode("idle");
      button.focus();
    }
  };
  window.addEventListener("keydown", onKey, true);

  const onResize = () => {
    if (mode === "card") placeCard();
  };
  window.addEventListener("resize", onResize);

  return () => {
    setMode("idle");
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onResize);
    layer.remove();
    buttonHost.remove();
    stopWatching();
  };
}
