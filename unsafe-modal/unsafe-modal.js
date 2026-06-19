// unsafe-modal — a Patchwork *component* that hosts privileged ("unsafe")
// system tools in a lightbox modal in the trusted host context.
//
// `<patchwork-view component="patchwork-unsafe-modal">` wraps the frame
// interior and listens for `patchwork:open-unsafe-modal` events bubbling up
// from descendants (e.g. the sideboard footer buttons). When one fires, it
// renders a fixed-position lightbox containing a `<patchwork-view>` that loads
// the requested document/tool in the host. This is used for system tools like
// account-picker, frame-configurator, and module-settings that need full repo
// access.
//
// Usage (in a frame tool):
//   <patchwork-view component="patchwork-unsafe-modal">
//     ... frame content ...
//   </patchwork-view>

const STYLE_TEXT = `
@layer package {
:root,
:host,
[theme] {
  /* The modal is a content surface hosting tool views, so it derives its
     fill/line/typography from the editor surface (not the studio chrome). */
  --unsafe-modal-fill: var(--editor-fill, white);
  --unsafe-modal-line: var(--editor-line, black);
  --unsafe-modal-border: var(--editor-fill-offset-20, #ccc);
  --unsafe-modal-family: var(--editor-family-sans, system-ui, sans-serif);
  --unsafe-modal-scrim: color-mix(in oklch, var(--editor-line, black), transparent 50%);
}
}

.unsafe-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--unsafe-modal-scrim);
}

.unsafe-modal-panel {
  position: relative;
  width: 90vw;
  max-width: 800px;
  height: 80vh;
  max-height: 600px;
  background: var(--unsafe-modal-fill);
  color: var(--unsafe-modal-line);
  font-family: var(--unsafe-modal-family);
  border: 1px solid var(--unsafe-modal-border);
  border-radius: var(--studio-radius-lg, 12px);
  box-shadow: var(--studio-shadow-lg, 0 25px 50px -12px rgba(0, 0, 0, 0.25));
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.unsafe-modal-close {
  position: absolute;
  top: 8px;
  right: 12px;
  z-index: 1;
  background: none;
  border: none;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  color: var(--unsafe-modal-line);
  opacity: 0.5;
  padding: 4px 8px;
}

.unsafe-modal-close:hover {
  opacity: 1;
}

/* Size and scroll the hosted view only — no colour/font here, so the tool
   inside styles itself exactly as it would in the main document view. */
.unsafe-modal-panel > patchwork-view {
  display: block;
  flex: 1;
  min-height: 0;
  overflow: auto;
}
`;

/**
 * @param {HTMLElement} element  the `<patchwork-view>` host
 * @param {import("@automerge/automerge-repo").Repo} _repo
 * @returns {() => void} cleanup
 */
function UnsafeModal(element, _repo) {
  const style = document.createElement("style");
  style.textContent = STYLE_TEXT;
  element.append(style);

  let backdrop = null;
  let onKeyDown = null;

  function dismiss() {
    if (onKeyDown) {
      document.removeEventListener("keydown", onKeyDown);
      onKeyDown = null;
    }
    if (backdrop) {
      backdrop.remove();
      backdrop = null;
    }
  }

  function show(detail) {
    dismiss();

    backdrop = document.createElement("div");
    backdrop.className = "unsafe-modal-backdrop";
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) dismiss();
    });

    const panel = document.createElement("div");
    panel.className = "unsafe-modal-panel";

    const closeBtn = document.createElement("button");
    closeBtn.className = "unsafe-modal-close";
    closeBtn.innerHTML = "&times;";
    closeBtn.title = "Close";
    closeBtn.addEventListener("click", dismiss);

    const view = document.createElement("patchwork-view");
    view.setAttribute("doc-url", detail.url);
    if (detail.toolId) view.setAttribute("tool-id", detail.toolId);

    panel.append(closeBtn, view);
    backdrop.append(panel);
    element.append(backdrop);

    onKeyDown = (e) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKeyDown);
  }

  function onOpenUnsafeModal(event) {
    const detail = event.detail;
    if (!detail?.url) return;
    event.stopPropagation();
    show(detail);
  }

  element.addEventListener("patchwork:open-unsafe-modal", onOpenUnsafeModal);

  return () => {
    element.removeEventListener("patchwork:open-unsafe-modal", onOpenUnsafeModal);
    dismiss();
    style.remove();
  };
}

export const plugins = [
  {
    type: "patchwork:component",
    id: "patchwork-unsafe-modal",
    name: "Unsafe Modal",
    async load() {
      return UnsafeModal;
    },
  },
];
