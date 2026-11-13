// the theme: each one drawn as a little patchwork in it (lattice's cards).
// which is chosen is the account's theme preferences (theme-preferences'
// tool storage, as `light` and `dark`), which the theming package watches
// and puts on the page. one theme for both unless you say otherwise
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { useToolStorage } from "../storage";
import { Toggle } from "../Toggle";
import type { AccountDoc } from "../you/contact";

type ThemeDescription = {
  id: string;
  name?: string;
  colorScheme?: "light" | "dark";
};
type Preferences = {
  light?: string;
  dark?: string;
  "@patchwork"?: { type: string };
};
type Mode = "light" | "dark";

const PREFERENCES = "theme-preferences";

// the site's own, for when nothing's been picked (as theming has it)
const defaultFor = (mode: Mode) =>
  document.documentElement.getAttribute(`data-theme-${mode}`) ||
  (mode === "dark" ? "gloom" : "lychee");

function useThemes() {
  const registry = getRegistry("patchwork:theme");
  const read = () =>
    ((registry.all?.() ?? []) as unknown as ThemeDescription[])
      .map((theme) => ({
        id: theme.id,
        name: theme.name || theme.id,
        colorScheme: theme.colorScheme,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  const [themes, setThemes] = createSignal(read());
  const off = registry.on("changed" as any, () => {
    setThemes(read());
  });
  onCleanup(() => (off as () => void)?.());
  return themes;
}

function useMode() {
  const query = matchMedia("(prefers-color-scheme: dark)");
  const [mode, setMode] = createSignal<Mode>(query.matches ? "dark" : "light");
  const onChange = () => setMode(query.matches ? "dark" : "light");
  query.addEventListener("change", onChange);
  onCleanup(() => query.removeEventListener("change", onChange));
  return mode;
}

/** a little patchwork, in a theme: its rules are all [theme="…"] */
export function ThemePreview(props: { id: string }) {
  return (
    <div class="settings-mini" attr:theme={props.id} aria-hidden="true">
      <div class="settings-mini-side">
        <b>documents</b>
        <span data-current>notes</span>
        <span>garden plan</span>
        <span>recipes</span>
      </div>
      <div class="settings-mini-main">
        <div class="settings-mini-top">
          <span>notes</span>
        </div>
        <div class="settings-mini-text">
          <div>
            <span class="h"># tuesday</span>
          </div>
          <div>
            water the <span class="k">tomatoes</span>
          </div>
          <div>
            <span class="l">[seed list]</span> <span class="c">// later</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Cards(props: {
  themes: ThemeDescription[];
  chosen: string;
  onChoose: (id: string) => void;
  label: string;
}) {
  return (
    <div
      class="settings-theme-cards"
      role="radiogroup"
      aria-label={props.label}
    >
      <For each={props.themes}>
        {(theme) => (
          <button
            type="button"
            class="settings-theme-card"
            role="radio"
            aria-checked={props.chosen === theme.id}
            onClick={() => props.onChoose(theme.id)}
          >
            <ThemePreview id={theme.id} />
            <span class="settings-theme-name">{theme.name}</span>
          </button>
        )}
      </For>
    </div>
  );
}

export function Theme(props: {
  element: HTMLElement;
  account: () => AccountDoc | undefined;
}) {
  const themes = useThemes();
  const mode = useMode();
  const [prefs, change] = useToolStorage<Preferences>(
    props.element,
    props.account,
    PREFERENCES,
    {
      init(doc) {
        if (!doc["@patchwork"]) doc["@patchwork"] = { type: PREFERENCES };
      },
    }
  );

  const chosen = (which: Mode) => prefs()?.[which] || defaultFor(which);
  // split only once someone's chosen two different ones
  const [splitByHand, setSplitByHand] = createSignal<boolean>();
  const split = createMemo(
    () => splitByHand() ?? chosen("light") !== chosen("dark")
  );

  const choose = (which: Mode | "both", id: string) =>
    change((doc) => {
      if (which !== "dark") doc.light = id;
      if (which !== "light") doc.dark = id;
    });

  // light themes first for light mode, dark ones for dark
  const forMode = (which: Mode) =>
    [...themes()].sort(
      (a, b) =>
        Number((a.colorScheme ?? which) !== which) -
        Number((b.colorScheme ?? which) !== which)
    );

  const name = (id: string) =>
    themes().find((theme) => theme.id === id)?.name ?? id;

  // one mode's cards, folded away under its name and the one it's set to
  const Picker = (p: { which: Mode }) => (
    <details class="settings-disclosure">
      <summary class="settings-row">
        <span class="settings-label settings-disclosure-label">
          {p.which === "light" ? "Light theme" : "Dark theme"}
          <Show when={split() && mode() === p.which}>
            <span class="settings-active">(Active)</span>
          </Show>
        </span>
        <span class="settings-disclosure-value">
          {name(chosen(p.which))}
        </span>
      </summary>
      <div class="settings-group-block">
        <Cards
          themes={forMode(p.which)}
          chosen={chosen(p.which)}
          onChoose={(id) => choose(split() ? p.which : "both", id)}
          label={p.which === "light" ? "Light theme" : "Dark theme"}
        />
      </div>
    </details>
  );

  return (
    <section class="settings-section" aria-labelledby="settings-theme">
      <h2 id="settings-theme">Theme</h2>
      <Show when={themes().length}>
        <div class="settings-group">
          <Picker which="light" />
          <div class="settings-row settings-row-switch-first">
            <Toggle
              id="settings-theme-split"
              checked={split()}
              onChange={(on) => {
                setSplitByHand(on);
                // back to one: the light one, for both
                if (!on) choose("both", chosen("light"));
              }}
            />
            <label class="settings-label" for="settings-theme-split">
              Use a different theme when Computer is in dark mode
            </label>
          </div>
          <Show when={split()}>
            <Picker which="dark" />
          </Show>
        </div>
      </Show>
    </section>
  );
}
