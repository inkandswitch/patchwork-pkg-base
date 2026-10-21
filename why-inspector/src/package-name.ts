// Turn a plugin's importUrl into the name of the package it came from.
// A trimmed copy of packages/src/pkg-meta.ts (copying beats linking, per the
// repo's CLAUDE.md): read package.json next to the module, else guess from
// the URL.

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const BUILD_DIRS = new Set(["dist", "build", "lib", "out", "es", "esm", "src"]);

async function fetchJson(url: string): Promise<any | undefined> {
  try {
    const res = await fetch(url);
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}

/** Path segments of an http URL, minus the entry file and build dirs. */
function packageDirs(url: URL): string[][] {
  const parts = url.pathname.split("/").filter(Boolean);
  if (/\.[a-z0-9]+$/i.test(parts[parts.length - 1] ?? "")) parts.pop();
  const tries = [parts.slice()];
  while (parts.length && BUILD_DIRS.has(parts[parts.length - 1].toLowerCase())) {
    parts.pop();
    tries.push(parts.slice());
  }
  return tries;
}

/** A readable name from the URL alone, for when package.json can't be read. */
export function guessName(importUrl: string): string {
  if (importUrl.startsWith("automerge:")) {
    const id = importUrl.slice("automerge:".length).replace(/[@?#/].*$/, "");
    return id.length > 8 ? `automerge:${id.slice(0, 6)}…` : importUrl;
  }
  try {
    const u = new URL(importUrl);
    const tries = packageDirs(u);
    const dirs = tries[tries.length - 1];
    return dirs[dirs.length - 1] || u.hostname;
  } catch {
    return importUrl;
  }
}

async function readName(importUrl: string): Promise<string | undefined> {
  const pick = (pkg: any) =>
    typeof pkg?.title === "string"
      ? pkg.title
      : typeof pkg?.name === "string"
        ? pkg.name
        : undefined;

  if (importUrl.startsWith("automerge:")) {
    const base = getImportableUrlFromAutomergeUrl(
      importUrl as Parameters<typeof getImportableUrlFromAutomergeUrl>[0]
    );
    return pick(await fetchJson(new URL("package.json", base).href));
  }
  if (/^https?:/i.test(importUrl)) {
    const u = new URL(importUrl);
    for (const dirs of packageDirs(u)) {
      const dir = dirs.join("/");
      const name = pick(
        await fetchJson(`${u.origin}/${dir}${dir ? "/" : ""}package.json`)
      );
      if (name) return name;
    }
  }
  return undefined;
}

const names = new Map<string, Promise<string>>();

/** The package's name (title, else name), else a guess from the URL. Cached. */
export function packageName(importUrl: string): Promise<string> {
  let name = names.get(importUrl);
  if (!name) {
    name = readName(importUrl)
      .catch(() => undefined)
      .then((n) => n ?? guessName(importUrl));
    names.set(importUrl, name);
  }
  return name;
}
