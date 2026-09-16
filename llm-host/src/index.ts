import type { Plugin } from "@inkandswitch/patchwork-plugins";

/**
 * @grjte/llm-host — the host-realm LLM package.
 *
 * `@chee/patchwork-llm` is a plain library (npm-bound, no Patchwork coupling).
 * This package is the Patchwork side of it: it registers what the platform needs
 * to know about, and owns everything that must run in the host realm because it
 * touches the settings doc and the API key.
 *
 * Three plugins:
 *
 *   `llm-config-tray` (patchwork:component)
 *     The system-tray icon that opens the model/config picker over the LLM
 *     settings doc. Consumer tools never read config — they open this tool via a
 *     `patchwork:open-tool` event (relayed across the isolation boundary) and
 *     otherwise just name a scope when they generate.
 *
 *   `llm` (patchwork:worker)
 *     The LLM worker itself. The generic worker provider
 *     (`@grjte/patchwork-worker`) resolves it by this id when a tool calls
 *     `connectWorker("llm", …)`, in or out of isolation. Registering it
 *     declaratively is what keeps the provider kind-agnostic: it no longer
 *     imports the LLM, so nothing service-specific loads until someone actually
 *     connects.
 *
 *   `llm` (patchwork:worker-client)
 *     The CONSUME half of the same protocol, paired with the worker by id. Its
 *     `load()` resolves to `makeLLMClient`, a factory `(session) => {generate}`.
 *     A tool calls `connectWorkerClient("llm", …)` from @grjte/patchwork-worker,
 *     which resolves this factory from the registry and binds it to a session —
 *     so the tool never imports this package. Both halves ship here and cannot
 *     drift. Under isolation the registry is mirrored into the iframe and the
 *     iframe loads this package's entry + the client chunk; nothing else of
 *     llm-host (and none of @chee/patchwork-llm) enters the sandbox.
 *
 * All three are behind `load()`, so importing this module registers descriptors
 * only — the library (worker, config, picker, transformers.js glue) is imported
 * lazily on first use rather than eagerly at frame mount. Descriptor fields must
 * stay plain data: the isolation bridge structured-clones them.
 */
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:component",
    id: "llm-config-tray",
    name: "LLM Model & Config",
    icon: "Bot",
    tags: ["system-tray"],
    async load() {
      const { LlmConfigTray } = await import("./LlmConfigTray.js");
      return LlmConfigTray;
    },
  },
  {
    type: "patchwork:worker",
    id: "llm",
    name: "LLM",
    async load() {
      // Resolves to a WorkerSpec that @grjte/patchwork-worker serves. The library
      // supplies the compute worker (createWorker) and the config/tool functions;
      // the spec below adds the LLM op vocabulary and the settings-doc resolution
      // that must run host-side (the key/settings doc never cross into a sandbox).
      // @ts-ignore — plain-JS library, ships no bundled types
      const lib = await import("@chee/patchwork-llm");
      // @ts-ignore — plain-JS sibling, JSDoc-typed
      const { makeLLMWorkerSpec } = await import("./worker-spec.js");
      return makeLLMWorkerSpec(lib);
    },
  },
  {
    type: "patchwork:worker-client",
    id: "llm",
    name: "LLM client",
    async load() {
      // The consume half: pure, imports nothing, safe to load into a sandbox.
      // @ts-ignore — plain-JS sibling, JSDoc-typed
      const { makeLLMClient } = await import("./client.js");
      return makeLLMClient;
    },
  },
];
