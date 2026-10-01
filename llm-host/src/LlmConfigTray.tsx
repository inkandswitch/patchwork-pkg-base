import { createSignal, onCleanup, Show } from "solid-js";
import { Portal, render } from "solid-js/web";
// @ts-ignore — plain-JS library, ships no type declarations
import {
  dom as pickerDom,
  ensureConfig,
  readScopedConfig,
  readConfig,
  writeScopeOverride,
  writeConfig,
} from "@chee/patchwork-llm";

/**
 * The LLM config tray tool — a `patchwork:component` (element) => cleanup.
 *
 * Runs in the HOST realm (it's a system-tray icon). It owns the picker UI over
 * the LLM settings doc. Chat (and anything else) opens it either by clicking the
 * tray icon or by dispatching a `patchwork:open-tool`
 * {detail:{component:"llm-config-tray", scope, toolPrompt, toolTools}} event
 * (relayed across the isolation boundary by the isolation open-tool bridge).
 *
 * The picker is driven through its injectable `source` {read, write} so this tool
 * is the sole owner of settings-doc writes; per-tool/per-doc scope overrides are
 * written via writeScopeOverride, the global default via writeConfig.
 */

/** @typedef {{toolId?: string, docId?: string, toolName?: string, docName?: string}} Scope */

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
			position: fixed; z-index: 2147483000;
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
  const [scope, setScope] = createSignal<Scope>({});
  const [payload, setPayload] = createSignal<any>({});
  const [pos, setPos] = createSignal<{ left: number; top: number } | null>(
    null
  );

  let buttonEl!: HTMLButtonElement;
  let popoverEl: HTMLDivElement | undefined;
  let pickerHost: HTMLDivElement | undefined;
  let currentPicker: any = null;

  // Build the picker's source from the current scope: scoped reads/writes when a
  // toolId is present, else the global default config.
  function sourceFor(sc: Scope) {
    if (sc && sc.toolId) {
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
    await ensureConfig(sc && sc.toolId ? sc : undefined, element);
    if (!pickerHost) return;
    pickerHost.replaceChildren();
    currentPicker = pickerDom({
      source: sourceFor(sc),
      scope: sc && sc.toolId ? sc : undefined,
      toolName: sc?.toolName || p.toolName,
      toolPrompt: p.toolPrompt,
      toolTools: p.toolTools,
    });
    pickerHost.append(currentPicker);
  }

  function positionPopover() {
    const r = buttonEl.getBoundingClientRect();
    // Prefer opening above the tray (tray sits at the bottom), aligned right.
    setPos({ left: Math.max(8, r.right - 520), top: Math.max(8, r.top - 8) });
  }

  function openPicker(sc: Scope, p: any) {
    setScope(sc || {});
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
    openPicker(detail.scope || {}, detail);
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
            else openPicker({}, {});
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
                transform: "translateY(-100%)",
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

  onCleanup(() => {
    try {
      currentPicker?.destroy?.();
    } catch {}
  });

  return () => {
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
