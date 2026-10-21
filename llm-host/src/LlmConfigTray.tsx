import { createSignal, Show } from "solid-js";
import { Portal, render } from "solid-js/web";

// @chee/patchwork-llm is an automerge: package, so importing it means fetching
// a doc through the service worker. The tray mounts on every boot, so it only
// loads the library when the picker opens: a static import made the button
// wait on that fetch, and on webkit closing a tab mid-fetch wedged the worker.
// @ts-ignore — plain-JS library, ships no type declarations
const loadLlm = () => import("@chee/patchwork-llm");

/**
 * The system-tray icon and popover for the LLM model/config picker. Host realm
 * only: it reads and writes the settings doc, which holds the API key.
 *
 * Opened by clicking the icon, or by a `patchwork:open-tool` event with
 * {detail: {component: "llm-config-tray", scope, toolPrompt, toolTools}}, which
 * isolation relays out of a sandbox. Scoped edits go through writeScopeOverride,
 * the global default through writeConfig.
 */

// A per-tool (and optionally per-doc) config scope. No scope = the global default.
type Scope = { toolId: string; docId?: string; toolName?: string; docName?: string };

export function LlmConfigTray(element: HTMLElement) {
  const style = document.createElement("style");
  style.textContent = `
		.llm-config-tray { position: relative; display: inline-flex; align-items: center; }
		.llm-config-tray-button {
			display: inline-flex; align-items: center; gap: var(--studio-space-2xs, 0.25rem);
			height: 1.75rem; padding: 0 var(--studio-space-xs, 0.375rem);
			border: 1px solid var(--studio-chrome-offset-20, var(--studio-fill-offset-20, #d4d4d4));
			border-radius: var(--studio-radius-sm, 4px);
			background: var(--studio-chrome, var(--studio-fill, white));
			color: var(--studio-chrome-line, var(--studio-line, black));
			font: 500 0.75rem/1 var(--studio-family-sans, system-ui, sans-serif); cursor: pointer;
		}
		.llm-config-tray-button:hover {
			background: var(--studio-chrome-offset-10, var(--studio-fill-offset-10, #f2f2f2));
		}
		.llm-config-tray-popover {
			position: fixed; z-index: 2147483000; box-sizing: border-box;
			max-width: min(92vw, 520px); max-height: 80vh; overflow: auto;
			background: var(--studio-fill, white); color: var(--studio-line, black);
			border: 1px solid var(--studio-fill-offset-20, #d4d4d4);
			border-radius: var(--studio-radius-md, 8px);
			box-shadow: var(--studio-shadow-lg, 0 8px 32px rgba(0,0,0,0.24));
			padding: var(--studio-space-sm, 0.5rem);
		}
	`;
  element.append(style);

  // Current scope the picker edits (set when opened via event; icon click uses
  // the global default scope).
  const [open, setOpen] = createSignal(false);
  const [scope, setScope] = createSignal<Scope | undefined>();
  const [payload, setPayload] = createSignal<any>({});
  const [pos, setPos] = createSignal<{
    left: number;
    top: number;
    maxHeight: number;
    above: boolean;
  } | null>(null);

  let buttonEl!: HTMLButtonElement;
  let popoverEl: HTMLDivElement | undefined;
  let pickerHost: HTMLDivElement | undefined;
  let currentPicker: any = null;

  function sourceFor(
    sc: Scope | undefined,
    { readScopedConfig, readConfig, writeScopeOverride, writeConfig }: any
  ) {
    if (sc) {
      return {
        read: () => {
          try {
            return readScopedConfig(sc);
          } catch {
            return readConfig();
          }
        },
        write: (next: any) => writeScopeOverride(sc, next),
      };
    }
    return {
      read: () => readConfig(),
      write: (next: any) => writeConfig(next),
    };
  }

  async function mountPicker() {
    const sc = scope();
    const p = payload() || {};
    const llm = await loadLlm();
    await llm.ensureConfig(sc, element);
    if (!pickerHost) return;
    pickerHost.replaceChildren();
    currentPicker = llm.dom({
      source: sourceFor(sc, llm),
      scope: sc,
      toolName: sc?.toolName || p.toolName,
      toolPrompt: p.toolPrompt,
      toolTools: p.toolTools,
    });
    pickerHost.append(currentPicker);
  }

  function positionPopover() {
    const r = buttonEl.getBoundingClientRect();
    const aboveSpace = Math.max(0, r.top - 16);
    const belowSpace = Math.max(0, window.innerHeight - r.bottom - 16);
    const above = aboveSpace >= Math.min(window.innerHeight * 0.8, belowSpace);
    setPos({
      left: Math.max(8, r.right - Math.min(520, window.innerWidth * 0.92)),
      top: above ? r.top - 8 : r.bottom + 8,
      maxHeight: Math.min(window.innerHeight * 0.8, above ? aboveSpace : belowSpace),
      above,
    });
  }

  function openPicker(sc: Partial<Scope> | undefined, p: any) {
    setScope(sc?.toolId ? (sc as Scope) : undefined);
    setPayload(p || {});
    positionPopover();
    setOpen(true);
    queueMicrotask(mountPicker);
  }

  function closePicker() {
    try {
      currentPicker?.destroy?.();
    } catch {}
    currentPicker = null;
    setOpen(false);
  }

  // Open via the `patchwork:open-tool` event (from chat / other tools, incl.
  // relayed across isolation). Match our component id.
  const onOpenTool = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (!detail || detail.component !== "llm-config-tray") return;
    openPicker(detail.scope, detail);
  };
  document.addEventListener("patchwork:open-tool", onOpenTool as EventListener);

  // Close on outside click. Use composedPath() (captured at event time, before
  // the picker re-renders its own DOM on a selection) rather than
  // popoverEl.contains(target): the picker rebuilds its option list when config
  // changes, so the clicked node is often already detached by the time the click
  // bubbles to document — contains() would then wrongly report "outside" and
  // close the popover on every model click.
  const onDocClick = (e: MouseEvent) => {
    if (!open()) return;
    const path = e.composedPath();
    if (
      (popoverEl && path.includes(popoverEl)) ||
      (buttonEl && path.includes(buttonEl))
    ) {
      return; // click was inside the popover or on the tray button
    }
    closePicker();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open()) closePicker();
  };
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onKey);

  const dispose = render(
    () => (
      <div class="llm-config-tray">
        <button
          ref={buttonEl}
          class="llm-config-tray-button"
          title="LLM model & config"
          onClick={(event) => {
            event.stopPropagation();
            if (open()) closePicker();
            else openPicker(undefined, {});
          }}
        >
          <span>🤖</span>
          <span>model</span>
        </button>
        <Show when={open()}>
          <Portal mount={document.body}>
            <div
              ref={popoverEl}
              class="llm-config-tray-popover"
              style={{
                left: `${pos()?.left ?? 0}px`,
                top: `${pos()?.top ?? 0}px`,
                "max-height": `${pos()?.maxHeight ?? 0}px`,
                transform: pos()?.above ? "translateY(-100%)" : "none",
                visibility: pos() ? "visible" : "hidden",
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div ref={pickerHost} />
            </div>
          </Portal>
        </Show>
      </div>
    ),
    element
  );

  return () => {
    closePicker();
    dispose();
    style.remove();
    document.removeEventListener(
      "patchwork:open-tool",
      onOpenTool as EventListener
    );
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onKey);
  };
}
