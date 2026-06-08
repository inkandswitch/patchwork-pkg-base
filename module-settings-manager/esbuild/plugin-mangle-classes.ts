/**
 * Post-build pass that shortens BEM class names. The codebase uses long,
 * unique names like `module-settings-manager__branch-picker-button--missing`
 * that repeat across both the bundled CSS and the JSX templates. Replacing
 * each one with a short alias (`_a`, `_b`, …) saves a few kb in both bundles.
 *
 * Strategy:
 *   1. After the build writes its outputs, scan the source CSS to enumerate
 *      every class name we own (matches one of the configured prefixes).
 *   2. Sort by length descending — replacing longer names first means a
 *      shorter name that happens to be a prefix of a longer one (e.g.
 *      `module-settings-manager` vs `module-settings-manager__title`)
 *      can't accidentally clobber the longer one mid-replacement.
 *   3. Read each emitted .css/.js file, do the substring replacements,
 *      write it back.
 *
 * Skips: any class name starting with a prefix in `dynamicPrefixes`. Those
 * families are constructed at runtime via template literals (e.g.
 * `` `msm-plugin__type--${kind}` ``), so the rendered class name doesn't
 * appear as a literal in the source — mangling the CSS would orphan it.
 */
import type { Plugin } from "esbuild";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface MangleOptions {
  /** Class names with one of these prefixes are eligible for mangling. */
  prefixes: string[];
  /** Class names with one of these prefixes are skipped (dynamic templates). */
  dynamicPrefixes?: string[];
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function alias(n: number): string {
  let s = "";
  let x = n;
  do {
    s = ALPHABET[x % ALPHABET.length] + s;
    x = Math.floor(x / ALPHABET.length) - 1;
  } while (x >= 0);
  // Leading underscore keeps the result a valid CSS ident even if it would
  // otherwise start with a digit-adjacent letter.
  return "_" + s;
}

function buildMap(
  cssText: string,
  { prefixes, dynamicPrefixes = [] }: MangleOptions
): Map<string, string> {
  const eligible = new Set<string>();
  for (const m of cssText.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
    const name = m[1];
    if (!prefixes.some((p) => name === p || name.startsWith(p))) continue;
    if (dynamicPrefixes.some((p) => name.startsWith(p))) continue;
    eligible.add(name);
  }
  // Length-desc so longer names are mangled before any name that's their
  // prefix would consume the substring.
  const sorted = [...eligible].sort(
    (a, b) => b.length - a.length || a.localeCompare(b)
  );
  const map = new Map<string, string>();
  sorted.forEach((name, i) => map.set(name, alias(i)));
  return map;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function apply(text: string, map: Map<string, string>): string {
  let out = text;
  for (const [from, to] of map) {
    if (out.indexOf(from) === -1) continue;
    // Bounded match so a name that's a prefix of another (`msm-plugin__type`
    // vs `msm-plugin__type--datatype`) doesn't eat the longer one. The
    // longer one might be excluded from `map` (e.g. dynamic-template
    // skip), so length-desc ordering alone is insufficient.
    const re = new RegExp(`(?<![\\w-])${escapeRe(from)}(?![\\w-])`, "g");
    out = out.replace(re, to);
  }
  return out;
}

async function walk(dir: string, exts: RegExp): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(p, exts)));
    else if (exts.test(e.name)) files.push(p);
  }
  return files;
}

export default function mangleClasses(
  cssSourcePath: string,
  options: MangleOptions
): Plugin {
  return {
    name: "mangle-classes",
    setup(build) {
      build.onEnd(async (result) => {
        if (result.errors.length) return;
        const outdir = build.initialOptions.outdir;
        if (!outdir) return;

        const cssText = await readFile(cssSourcePath, "utf8");
        const map = buildMap(cssText, options);
        if (map.size === 0) return;

        const files = await walk(outdir, /\.(css|js)$/);
        await Promise.all(
          files.map(async (f) => {
            const text = await readFile(f, "utf8");
            const replaced = apply(text, map);
            if (replaced !== text) await writeFile(f, replaced);
          })
        );
      });
    },
  };
}
