// Shared by the button's shadow root and the overlay's. Colours come from the
// studio theme when it's there, with plain fallbacks for light and dark.

export const styles = /* css */ `
:host {
  --why-fill: var(--studio-fill, #fff);
  --why-line: var(--studio-line, #111);
  --why-muted: color-mix(in oklch, var(--why-line), transparent 45%);
  --why-edge: color-mix(in oklch, var(--why-line), transparent 82%);
  --why-accent: var(--studio-primary-fill, var(--studio-primary, #0a7d6a));
  --why-warn: var(--studio-danger-text, var(--studio-danger, #c0244f));
  --why-code: var(--studio-family-code, ui-monospace, monospace);
  --why-sans: var(--studio-family-sans, system-ui, sans-serif);
  font-family: var(--why-sans);
}
@media (prefers-color-scheme: dark) {
  :host {
    --why-fill: var(--studio-fill, #1b1b1d);
    --why-line: var(--studio-line, #eee);
    --why-accent: var(--studio-primary-fill, var(--studio-primary, #35f7ca));
    --why-warn: var(--studio-danger-text, var(--studio-danger, #ff6a90));
  }
}

/* the tray button */
.why-button {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--why-edge);
  border-radius: 999px;
  background: transparent;
  color: var(--why-muted);
  font: 600 13px/1 var(--why-sans);
  cursor: pointer;
}
.why-button:hover,
.why-button:focus-visible {
  color: var(--why-line);
  border-color: var(--why-muted);
}
.why-button[aria-pressed="true"] {
  background: var(--why-accent);
  border-color: var(--why-accent);
  color: var(--why-fill);
}

/* pointing mode: the whole window becomes a crosshair */
.catcher {
  position: fixed;
  inset: 0;
  display: none;
  cursor: crosshair;
  pointer-events: auto;
}
.catcher.on {
  display: block;
}

.outline {
  position: fixed;
  box-sizing: border-box;
  border: 2px solid var(--why-accent);
  border-radius: 4px;
  background: color-mix(in oklch, var(--why-accent), transparent 90%);
  pointer-events: none;
  transition: left 80ms ease, top 80ms ease, width 80ms ease, height 80ms ease;
}

.tag {
  position: fixed;
  max-width: 320px;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--why-line);
  color: var(--why-fill);
  font: 12px/1.4 var(--why-sans);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

.outline[hidden],
.tag[hidden],
.card[hidden] {
  display: none;
}

/* the card */
.card {
  position: fixed;
  box-sizing: border-box;
  width: min(360px, calc(100vw - 16px));
  max-height: calc(100vh - 80px);
  overflow: auto;
  padding: 10px 12px 12px;
  border: 1px solid var(--why-edge);
  border-radius: 8px;
  background: var(--why-fill);
  color: var(--why-line);
  box-shadow: 0 8px 28px color-mix(in oklch, black, transparent 78%);
  font: 13px/1.45 var(--why-sans);
  pointer-events: auto;
}
.card header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.card header strong {
  flex: 1;
}
.text-button,
.close,
.copy {
  border: 0;
  background: transparent;
  color: var(--why-muted);
  font: inherit;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
}
.text-button:hover,
.close:hover,
.copy:hover {
  color: var(--why-line);
  background: var(--why-edge);
}
.close {
  font-size: 16px;
  line-height: 1;
}
.copy {
  font: 12px/1.4 var(--why-code);
}

.chain {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  margin: 8px 0;
  padding: 0;
  list-style: none;
}
.chain li {
  display: flex;
  align-items: center;
}
.chain li + li::before {
  content: "›";
  padding: 0 3px;
  color: var(--why-muted);
}
.chip {
  max-width: 160px;
  padding: 1px 7px;
  border: 1px solid var(--why-edge);
  border-radius: 999px;
  background: transparent;
  color: var(--why-line);
  font: 12px/1.5 var(--why-sans);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.chip--component {
  color: var(--why-muted);
}
.chip--isolated {
  border-style: dashed;
}
.chip:hover,
.chip:focus-visible {
  border-color: var(--why-accent);
}
.chip[aria-current="true"] {
  background: var(--why-accent);
  border-color: var(--why-accent);
  color: var(--why-fill);
}

.note {
  margin: 0 0 8px;
  padding: 6px 8px;
  border-left: 3px dashed var(--why-accent);
  color: var(--why-muted);
}
.facts dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  margin: 0;
}
.facts dt {
  color: var(--why-muted);
}
.facts dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
code {
  font: 12px/1.45 var(--why-code);
}
.warn {
  color: var(--why-warn);
}

/* heads blink when someone edits the doc */
.heads.ticked {
  animation: why-tick 700ms ease-out;
}
@keyframes why-tick {
  from {
    background: color-mix(in oklch, var(--why-accent), transparent 40%);
  }
  to {
    background: transparent;
  }
}
@media (prefers-reduced-motion: reduce) {
  .outline {
    transition: none;
  }
}
`;
