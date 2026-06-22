import "./global.css";

declare const __KEYHIVE__: boolean;

import { bootPatchworkSite } from "@inkandswitch/patchwork-bootloader/site";

// This is just the *shell* (the boot runtime + shared dependencies). The actual
// tool bundle is deployed separately as a static `modules.json` manifest + the
// tools' compiled JS (see the repo root's `scripts/build-static.mjs`). The shell
// fetches that manifest at boot and dynamically imports each tool over HTTP, so
// the shell can run anywhere (the deployed PWA, `vite preview`, localhost) while
// pointing at any tools host.
//
// Resolution order for the default tool manifest:
//   1. `localStorage.defaultToolsUrl` — runtime override (handled by the
//      bootloader), e.g. point a deployed shell at a local tools server.
//   2. `VITE_DEFAULT_MODULES` — build-time env (comma-separated list of
//      sources; each may be an `automerge:` URL or a static manifest URL).
//   3. the canonical Netlify tools bundle (fallback below).
//
// Each user's personal Automerge module-settings doc (created by the frame)
// continues to layer on top, so individual tools can come from either target.
//
// NOTE: update this to the real Netlify site URL once it's created, or just
// rely on VITE_DEFAULT_MODULES / localStorage.defaultToolsUrl.
const DEFAULT_TOOLS_URL =
  "https://patchwork-base-tools.netlify.app/modules.json";

const defaultModules = (import.meta.env.VITE_DEFAULT_MODULES ?? DEFAULT_TOOLS_URL)
  .split(",")
  .map((source) => source.trim())
  .filter(Boolean);

await bootPatchworkSite({
  defaultModules,
  accountStorageKey: "patchworkBaseAccountUrl",
  titleSuffix: "patchwork-base",
  keyhive: __KEYHIVE__,
});
