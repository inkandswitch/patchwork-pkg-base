# patchwork-base-site (the shell)

This is the **shell**: the boot runtime plus the shared dependencies (Automerge,
Solid, the plugin system, the service worker, the import map). It contains **no
tools**. At boot it fetches a `modules.json` manifest from a *tools host* and
dynamically `import()`s each tool over HTTP — so the shell can be deployed once
(as a PWA at a well-known URL) and run anywhere, while pointing at any tools
deployment (Netlify, a local server, etc.).

The tools bundle (`modules.json` + `tools/<tool>/dist/…`) is built and deployed
separately — see the repo root's `README`/scripts (`build:static`,
`serve:tools`, `deploy:tools`). It's deployed to Netlify (the repo is private,
so GitHub Pages isn't an option without a paid plan).

You can still mix in Automerge-hosted tools — see [Mixing deployment
targets](#mixing-deployment-targets).

## How it works

1. The root `scripts/build-static.mjs` aggregates every tool's built `dist/`
   into `../static-dist/tools/<tool>/` and writes a `modules.json` manifest of
   relative tool entry-point URLs. The manifest has the same shape as a
   Patchwork module-settings document, but it is a static file.
2. That bundle is deployed to a static host (Netlify, or `pnpm serve:tools`
   locally).
3. This shell's `src/main.ts` resolves the manifest URL (see below) and boots
   with `defaultModules: [<manifest url>]`.
4. The bootloader's `ModuleWatcher` fetches the manifest and `import()`s each
   tool. The manifest's relative `./tools/…` URLs resolve against the manifest's
   own URL, so the bundle works at any host/base path. The tools' shared
   dependencies resolve through the import map the bootloader's Vite plugin
   injects into `index.html` (always served from the shell's origin).

### Which tools manifest does the shell load?

Resolution order (first match wins):

1. **`localStorage.defaultToolsUrl`** — runtime override, no rebuild. Point a
   deployed shell at a local tools server:
   `localStorage.defaultToolsUrl = "http://localhost:4455/modules.json"`.
2. **`VITE_DEFAULT_MODULES`** — build-time env (comma-separated list of sources;
   each may be an `automerge:` URL or a static manifest URL).
3. **Fallback** — the canonical Netlify bundle (the `DEFAULT_TOOLS_URL` constant
   in `src/main.ts`; update it once the Netlify site exists).

## Build & run

```sh
pnpm install
pnpm dev        # vite dev server (uses the VITE_DEFAULT_MODULES env / fallback)
pnpm build      # build just the shell (no tools baked in)
pnpm preview    # serve dist/ locally with the required COOP/COEP headers
```

Point the shell at a specific tools host at build time:

```sh
VITE_DEFAULT_MODULES=http://localhost:4455/modules.json pnpm build
```

Local end-to-end (two terminals):

```sh
# terminal 1 — tools host (from repo root)
pnpm dev:tools                     # build:static + serve static-dist on :4455 with CORS

# terminal 2 — shell pointed at it
VITE_DEFAULT_MODULES=http://localhost:4455/modules.json pnpm --dir site preview
```

`pnpm build` produces just the shell:

```
dist/
  index.html
  packages/*.js        shared externals (import map targets)
  *.wasm               automerge / subduction / keyhive
  service-worker.js
  manifest.webmanifest
```

Cross-origin tool loading requires the **shell** to send
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: credentialless` (the Vite dev/preview config and
`public/_headers` already do), and the **tools host** to send
`Access-Control-Allow-Origin: *` (Netlify gets this from the `_headers` file
that `build:static` writes into the bundle; `serve:tools` sets it for local dev).

## Mixing deployment targets

Both the *source of the module list* and *each module within it* can be either
static HTTP or Automerge, so you can freely combine deployment targets:

- **Add an Automerge tool set alongside the static one** — pass several sources:

  ```ts
  await bootPatchworkSite({
    defaultModules: ["/modules.json", "automerge:…"],
    // …
  });
  ```

- **Per-tool mixing** — a `modules.json` (or an Automerge settings doc) may list
  both `automerge:…` folder-doc URLs and `https://…/index.js` bundles.

- **Runtime override** — set `localStorage.defaultToolsUrl` to another manifest
  URL (`/some-other.json`, `https://…`) or an `automerge:` URL to replace the
  built-in default bundle without rebuilding.

- **Per-user tools** — each user's personal Automerge module-settings doc
  (created by the frame) continues to layer on top of the site default.

## Dependency note (pre-publish linking + version alignment)

This site depends on four `@inkandswitch/patchwork-*` packages that add the
static-manifest module source (`patchwork-bootloader@^0.3.0`,
`patchwork-filesystem@^0.1.0`, plus `patchwork-elements` and
`patchwork-plugins`). Until those versions are published to npm, install can't
resolve them, so `package.json` carries local `pnpm.overrides` that point them at
a sibling `patchwork-next` checkout:

```json
"pnpm": {
  "overrides": {
    "@inkandswitch/patchwork-bootloader": "link:../../patchwork-next/core/bootloader",
    "@inkandswitch/patchwork-elements":   "link:../../patchwork-next/core/elements",
    "@inkandswitch/patchwork-filesystem": "link:../../patchwork-next/core/filesystem",
    "@inkandswitch/patchwork-plugins":    "link:../../patchwork-next/core/plugins"
  }
}
```

Rebuild those packages in `patchwork-next` (`pnpm --filter … build`) before
building the site. Once the packages are published, delete these `link:`
overrides and rely on the npm ranges in `dependencies`.

### Automerge / subduction versions must match the bootloader

The Vite plugin (from the linked/installed bootloader) emits the WASM binaries
(`subduction.wasm`, `automerge.wasm`, …) resolved from the **bootloader's**
dependency tree, while the runtime JS glue is bundled from **this site's**
dependency tree via the import map. If the two trees resolve different versions
of `@automerge/automerge-subduction` (or `@automerge/automerge`), the WASM
import fails at boot with an error like:

```
WebAssembly.Instance(): Import #21 "./snippets/subduction_wasm-…/inline0.js":
module is not an object or function
```

(The snippet hash baked into the WASM no longer matches the glue.) To prevent
this, `pnpm.overrides` also pins the whole Automerge stack to a single version
that matches what `patchwork-next` resolves (currently
`@automerge/automerge-subduction@0.14.0` and
`@automerge/automerge-repo@2.6.0-subduction.28`). Keep these in sync whenever
`patchwork-next` bumps its Automerge versions.
