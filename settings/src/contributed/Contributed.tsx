// a section for each `patchwork:settings` plugin: its JSON, drawn. nothing
// of the plugin's runs here; the page only reads its description out of the
// registry (it never calls load). values go in the plugin's tool storage
import { createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { useToolStorage } from "../storage";
import type { AccountDoc } from "../you/contact";
import {
  clampNumber,
  optionsOf,
  SETTINGS_PLUGIN_TYPE,
  settingsOf,
  setValueAt,
  settingValue,
  valueAt,
  type Setting,
  type SettingsPlugin,
} from "../schema";

function useSettingsPlugins() {
  const registry = getRegistry(SETTINGS_PLUGIN_TYPE);
  const read = () =>
    ((registry.all?.() ?? []) as unknown as SettingsPlugin[])
      .filter((plugin) => typeof plugin?.id === "string")
      .sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)));
  const [plugins, setPlugins] = createSignal(read());
  const off = registry.on("changed" as any, () => {
    setPlugins(read());
  });
  onCleanup(() => (off as () => void)?.());
  return plugins;
}

export function Contributed(props: { element: HTMLElement; account: () => AccountDoc | undefined }) {
  const plugins = useSettingsPlugins();
  return (
    <For each={plugins()}>
      {(plugin) => <PluginSection plugin={plugin} element={props.element} account={props.account} />}
    </For>
  );
}

function PluginSection(props: {
  plugin: SettingsPlugin;
  element: HTMLElement;
  account: () => AccountDoc | undefined;
}) {
  const settings = createMemo(() => settingsOf(props.plugin));
  const [doc, change] = useToolStorage<Record<string, unknown>>(props.element, props.account, props.plugin.id);
  const set = (key: string, value: unknown) => change((d) => setValueAt(d, key, value));
  const headingId = `settings-plugin-${props.plugin.id.replace(/[^\w-]/g, "-")}`;

  return (
    <Show when={settings().length}>
      <section class="settings-section" aria-labelledby={headingId}>
        <h2 id={headingId}>{props.plugin.name || props.plugin.id}</h2>
        <Show when={props.plugin.description}>
          <p class="settings-hint">{props.plugin.description}</p>
        </Show>
        <For each={settings()}>
          {([key, setting]) => (
            <Field
              id={`${headingId}-${key.replace(/\./g, "-")}`}
              name={key}
              setting={setting}
              value={settingValue(doc(), key, setting)}
              chosen={valueAt(doc(), key) !== undefined}
              set={(value) => set(key, value)}
            />
          )}
        </For>
      </section>
    </Show>
  );
}

function Field(props: {
  id: string;
  name: string;
  setting: Setting;
  value: unknown;
  chosen: boolean;
  set: (value: unknown) => void;
}) {
  const label = () => props.setting.title || props.name;
  const text = (value: unknown) => (value === undefined || value === null ? "" : String(value));

  const control = () => (
    <Switch>
      <Match when={props.setting.type === "boolean"}>
        <input
          id={props.id}
          type="checkbox"
          checked={props.value === true}
          onChange={(event) => props.set(event.currentTarget.checked)}
        />
      </Match>
      <Match when={props.setting.type === "string" && props.setting}>
        {(setting) => {
          const s = setting() as Extract<Setting, { type: "string" }>;
          return s.multiline ? (
            <textarea
              id={props.id}
              class="settings-input settings-grow"
              rows={3}
              placeholder={s.placeholder}
              value={text(props.value)}
              onChange={(event) => props.set(event.currentTarget.value)}
            />
          ) : (
            <input
              id={props.id}
              class="settings-input settings-grow"
              placeholder={s.placeholder}
              value={text(props.value)}
              onChange={(event) => props.set(event.currentTarget.value)}
            />
          );
        }}
      </Match>
      <Match when={props.setting.type === "number" && props.setting}>
        {(setting) => {
          const s = setting() as Extract<Setting, { type: "number" }>;
          return (
            <span class="settings-cluster">
              <input
                id={props.id}
                class="settings-input settings-number"
                type="number"
                min={s.min}
                max={s.max}
                step={s.step ?? "any"}
                value={text(props.value)}
                onChange={(event) => {
                  const n = clampNumber(event.currentTarget.value, s);
                  props.set(n);
                  // held to the bounds: show what was kept
                  event.currentTarget.value = text(n ?? s.default);
                }}
              />
              <Show when={s.unit}>
                <span class="settings-hint">{s.unit}</span>
              </Show>
            </span>
          );
        }}
      </Match>
      <Match when={props.setting.type === "enum" && props.setting}>
        {(setting) => {
          const s = setting() as Extract<Setting, { type: "enum" }>;
          return (
            <select
              id={props.id}
              class="settings-input"
              onChange={(event) => props.set(event.currentTarget.value || undefined)}
            >
              <Show when={s.default === undefined}>
                <option value="" selected={!props.value}>
                  —
                </option>
              </Show>
              <For each={optionsOf(s)}>
                {(option) => (
                  <option value={option.value} selected={props.value === option.value}>
                    {option.label}
                  </option>
                )}
              </For>
            </select>
          );
        }}
      </Match>
      <Match when={props.setting.type === "color"}>
        <input
          id={props.id}
          class="settings-color-input"
          type="color"
          value={text(props.value) || "#000000"}
          onInput={(event) => props.set(event.currentTarget.value)}
        />
      </Match>
    </Switch>
  );

  return (
    <div class="settings-row" data-type={props.setting.type}>
      <label class="settings-label" for={props.id}>
        {label()}
      </label>
      <span class="settings-control">
        {control()}
        <Show when={props.chosen}>
          <button
            type="button"
            class="settings-reset"
            title="back to the default"
            aria-label={`put ${label()} back to the default`}
            onClick={() => props.set(undefined)}
          >
            reset
          </button>
        </Show>
      </span>
      <Show when={props.setting.description}>
        <p class="settings-hint settings-row-hint">{props.setting.description}</p>
      </Show>
    </div>
  );
}
