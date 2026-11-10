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

  return (
    <section class="settings-section" aria-labelledby="settings-theme">
      <h2 id="settings-theme">Theme</h2>
      <Show when={themes().length}>
        <div class="settings-group">
          <Show
            when={split()}
            fallback={
              <div class="settings-group-block">
                <Cards
                  themes={themes()}
                  chosen={chosen(mode())}
                  onChoose={(id) => choose("both", id)}
                  label="Theme"
                />
              </div>
            }
          >
            <For each={["light", "dark"] as Mode[]}>
              {(which) => (
                <div class="settings-group-block settings-theme-mode">
                  <h3>
                    {which === "light" ? "Light mode" : "Dark mode"}
                    <Show when={mode() === which}>
                      <span class="settings-now">Now</span>
                    </Show>
                  </h3>
                  <Cards
                    themes={forMode(which)}
                    chosen={chosen(which)}
                    onChoose={(id) => choose(which, id)}
                    label={
                      which === "light" ? "Light mode theme" : "Dark mode theme"
                    }
                  />
                </div>
              )}
            </For>
          </Show>
          <div class="settings-row">
            <label class="settings-label" for="settings-theme-split">
              Use a different theme when Computer is in dark mode
            </label>
            <Toggle
              id="settings-theme-split"
              checked={split()}
              onChange={(on) => {
                setSplitByHand(on);
                // back to one: the one that's showing now, for both
                if (!on) choose("both", chosen(mode()));
              }}
            />
          </div>
        </div>
      </Show>
    </section>
  );
}
