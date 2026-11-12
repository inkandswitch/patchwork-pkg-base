/**
 * `patchwork:settings` — a package's settings, as static JSON.
 *
 * A package that wants a section on the settings page registers one plugin
 * of this type alongside its others. It carries no code: the settings page
 * draws every control itself, from the `properties` map.
 *
 *     {
 *       type: "patchwork:settings",
 *       id: "my-tool",              // whose tool storage the values go in
 *       name: "My tool",            // the section's heading
 *       properties: {
 *         "wrap":       { type: "boolean", title: "Wrap long lines", default: true },
 *         "font.size":  { type: "number", min: 8, max: 32, unit: "px", default: 14 },
 *         "greeting":   { type: "string", placeholder: "hello" },
 *         "mode":       { type: "enum", options: ["fast", { value: "slow", label: "Careful" }] },
 *         "highlight":  { type: "color" }
 *       }
 *     }
 *
 * Where the values live: the account's tool storage for `id` — the same doc
 * the tool gets from `{ type: "patchwork:tool-storage", toolId: id }`. Each
 * key is a dotted path into that doc (`"font.size"` is `doc.font.size`).
 * Nothing is written until someone changes a setting, so a tool reads
 * `valueAt(doc, key) ?? properties[key].default` — it shipped the defaults
 * itself, so it needs nobody to tell it them.
 */

export const SETTINGS_PLUGIN_TYPE = "patchwork:settings";

type Common = {
  /** the label. defaults to the key */
  title?: string;
  /** a line under the label */
  description?: string;
};

export type BooleanSetting = Common & { type: "boolean"; default?: boolean };
export type StringSetting = Common & {
  type: "string";
  default?: string;
  placeholder?: string;
  multiline?: boolean;
};
export type NumberSetting = Common & {
  type: "number";
  default?: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
};
export type EnumOption = string | { value: string; label?: string };
export type EnumSetting = Common & {
  type: "enum";
  options: EnumOption[];
  default?: string;
};
export type ColorSetting = Common & { type: "color"; default?: string };

export type Setting =
  | BooleanSetting
  | StringSetting
  | NumberSetting
  | EnumSetting
  | ColorSetting;

export type SettingsPlugin = {
  type: typeof SETTINGS_PLUGIN_TYPE;
  id: string;
  name: string;
  description?: string;
  properties: Record<string, Setting>;
};

const TYPES = new Set(["boolean", "string", "number", "enum", "color"]);
const KEY = /^[A-Za-z_$][\w$-]*(\.[A-Za-z_$][\w$-]*)*$/;
const UNSAFE = new Set(["__proto__", "prototype", "constructor"]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** whether `key` is a dotted path we'll write into a doc */
export function isValidKey(key: string): boolean {
  return KEY.test(key) && !key.split(".").some((part) => UNSAFE.has(part));
}

/**
 * the settings in `plugin` the page can draw, in the order they were
 * declared. anything malformed is left out (and said so in the console),
 * so one bad entry doesn't cost a package its whole section
 */
export function settingsOf(plugin: unknown): [string, Setting][] {
  if (!isObject(plugin) || !isObject(plugin.properties)) return [];
  const out: [string, Setting][] = [];
  for (const [key, setting] of Object.entries(plugin.properties)) {
    if (!isValidKey(key)) {
      console.warn(`[settings] ${plugin.id}: "${key}" isn't a usable key`);
      continue;
    }
    if (!isObject(setting) || !TYPES.has(setting.type as string)) {
      console.warn(`[settings] ${plugin.id}.${key}: unknown setting type`, setting);
      continue;
    }
    if (setting.type === "enum" && !Array.isArray(setting.options)) {
      console.warn(`[settings] ${plugin.id}.${key}: an enum needs options`);
      continue;
    }
    out.push([key, setting as Setting]);
  }
  return out;
}

export function optionsOf(setting: EnumSetting): { value: string; label: string }[] {
  return setting.options.map((option) =>
    typeof option === "string"
      ? { value: option, label: option }
      : { value: option.value, label: option.label ?? option.value },
  );
}

/** what's at a dotted path in a doc, or undefined */
export function valueAt(doc: unknown, key: string): unknown {
  let here: unknown = doc;
  for (const part of key.split(".")) {
    if (!isObject(here)) return undefined;
    here = here[part];
  }
  return here;
}

/** the value someone's chosen, or the setting's default */
export function settingValue(doc: unknown, key: string, setting: Setting): unknown {
  const value = valueAt(doc, key);
  return value === undefined || value === null ? setting.default : value;
}

/**
 * put a value at a dotted path, inside a `change`. `undefined` takes it out
 * (automerge can't hold undefined), which puts the setting back to its default
 */
export function setValueAt(doc: Record<string, unknown>, key: string, value: unknown) {
  if (!isValidKey(key)) throw new Error(`[settings] "${key}" isn't a usable key`);
  const parts = key.split(".");
  const last = parts.pop()!;
  let here: Record<string, unknown> = doc;
  for (const part of parts) {
    if (!isObject(here[part])) {
      if (value === undefined) return;
      here[part] = {};
    }
    here = here[part] as Record<string, unknown>;
  }
  if (value === undefined) delete here[last];
  else here[last] = value;
}

/** a number from an input, held to the setting's bounds; undefined if it isn't one */
export function clampNumber(raw: string, setting: NumberSetting): number | undefined {
  if (raw.trim() === "") return undefined;
  let n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  if (setting.min !== undefined) n = Math.max(setting.min, n);
  if (setting.max !== undefined) n = Math.min(setting.max, n);
  return n;
}
