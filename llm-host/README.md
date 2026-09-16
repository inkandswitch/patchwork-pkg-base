# @grjte/llm-host

The **host-realm LLM package**. It is the Patchwork side of the LLM: everything
that must run in a real-origin host realm because it touches the settings doc and
the API key. It registers two plugins:

- **`llm-config-tray`** (`patchwork:component`, tag `system-tray`) — the settings
  doc + the model/config picker UI, so no other tool needs to read or write LLM
  config. Renders a small icon in the frame's system tray; clicking it, or a
  `patchwork:open-tool` event, opens the picker in a popover.
- **`llm`** (`patchwork:worker`) — the LLM worker itself. Its `load()` resolves a
  **WorkerSpec** (via `makeLLMWorkerSpec`) that `@grjte/patchwork-worker` serves, so
  a consumer reaches it by `connectWorker("llm", …)` — in or out of isolation.

The design goal, and the reason this package exists as host-realm code: the LLM
worker (and the config + API key it needs) runs in the **host realm**, while a
consumer tool like chat holds only streams — the same code whether or not it runs
inside a sandboxed iframe.

This README covers both the config tray (below) and the full LLM architecture (from
"Three layers" onward). The **generic** worker machinery it rides on — the
`WorkerSpec` contract, `connectWorker` / `serveWorkerSpec`, discovery and the
transferable-stream handoff, one-worker-per-connection — is documented in
[`../libraries/patchwork-worker/README.md`](../libraries/patchwork-worker/README.md). This package adds
the LLM-specific parts: the op vocabulary, the config/secret trust boundary, and the
config tray.

---

## The config tray (`llm-config-tray`)

### What it owns

- **The settings doc.** LLM config lives in a dedicated Automerge document whose
  body *is* the config (`provider`, per-provider `model`/`apiKey`/`url`, sampling
  params, `toolToggles`, prompt-doc refs, and per-tool/per-doc overrides). The
  account doc only holds a *pointer* to it (`accountDoc.toolStorage["llm"]`),
  resolved via the `patchwork:tool-storage` provider. The only secret is
  `openrouter.apiKey`, stored here and nowhere else.
- **The picker UI.** It reuses `@chee/patchwork-llm`'s `dom()` picker, driven
  through the picker's injectable `source` `{read, write}` — backed by
  `readScopedConfig` / `writeScopeOverride` / `writeConfig`. So this tool is the
  sole writer of the settings doc; the picker never touches the doc singletons
  directly.

### How it's opened

- **Sidebar icon:** the tray button toggles the popover.
- **`patchwork:open-tool` event:** any tool can dispatch
  `new CustomEvent("patchwork:open-tool", { detail: { component: "llm-config-tray",
  scope, toolPrompt, toolTools }, bubbles: true, composed: true })`. The tray has a
  document-level listener that opens the picker for that `scope` and surfaces the
  caller's `toolPrompt` / `toolTools` (tools tagged `defaultOff` render unchecked).
  This is how chat's `/model` opens it — and, when chat runs inside the isolation
  sandbox, the isolation *open-tool bridge* relays the event to the host so this
  host-realm tool opens there.

### Why host-only

The settings doc (with the API key) is denylisted from the isolation sandbox, and
resolving it needs `window.repo` + a mounted `<patchwork-view>`. So config
management can only run in the host realm. This tool is mounted by the frame as host
chrome; consumer tools stay config-free and reach it via the event above.

---

## The packages

```
 @grjte/patchwork-worker   the generic transport (connect / session / serve halves), a
                           plain library. Knows nothing about LLMs. See its README. The
                           host-realm provider that drives it (patchwork-worker-provider)
                           ships from the `providers` package. The LLM uses it unchanged:
                           it registers a WorkerSpec and connects by the id "llm".

 @chee/patchwork-llm       the LLM library. Owns worker.js (transformers.js / OpenRouter /
                           Ollama), config resolution over the settings doc (config.js:
                           ensureConfig, callConfig, the apiKey), the picker UI, tool
                           parsing, request preparation (request.js: prepareGenerate +
                           buildGeneratePayload, shared by its own generate() and by
                           worker-spec.js below, so the two paths cannot diverge), and
                           `createWorker()` — the ONE worker-transport
                           concern that must live here, because
                           `new URL("./worker.js", import.meta.url)` has to resolve
                           against this library's own (cross-origin) URL, and bundlers
                           only emit the worker chunk when they see that exact literal.
                           NOTE: this is a Patchwork-coupled library, not a plain npm
                           one — it imports @inkandswitch/patchwork-{elements,providers},
                           reads the account/settings docs, and ships a
                           <patchwork-llm-config-provider> element. It has no `plugins`
                           array, so importing it registers nothing; llm-host is what
                           makes it a Patchwork worker.

 @grjte/llm-host           THIS package — the host-realm glue. Registers THREE plugins:
                           llm-config-tray (component), llm (patchwork:worker) and llm
                           (patchwork:worker-client). Owns BOTH halves of the LLM
                           protocol: src/worker-spec.js (serve half: host policy — which
                           overrides a consumer may set, system maps, toolToggles,
                           host-side <tool_call> parsing — over the library's request
                           preparation) and src/client.js (consume half: makeLLMClient,
                           pure, delivered to consumers THROUGH THE REGISTRY as a lazy
                           dist chunk). The library is imported lazily, so nothing
                           LLM-specific loads until first connect.

 chat (@patchwork/chat*)   the CONSUMER. Imports only the transport
                           (@grjte/patchwork-worker, a library); has NO dependency on
                           this package. Calls connectWorkerClient("llm") and receives
                           makeLLMClient's {generate} at runtime; runs no worker; opens
                           config via event. Reads ZERO config.

 @patchwork/isolation      the sandbox. When chat runs inside it, three relays cross the
                           boundary: worker-channel (streams), open-tool (config picker),
                           and the registry source-rewrite (so tool code + its automerge
                           deps load). None of it is LLM-specific.

 threepane                 the host frame. Mounts patchwork-worker-provider + the config
                           tray; sets shared-providers on the isolation element.
```

## Three layers, each kind-agnostic below the one above

```
   layer      package               serve half            consume half
   -----      -------               ----------            ------------
   transport  patchwork-worker      serveWorkerSpec       openSession / connectWorkerClient
   protocol   llm-host              src/worker-spec.js    src/client.js (makeLLMClient)
   compute    @chee/patchwork-llm   worker.js             createWorker
```

The transport knows nothing about the LLM's op vocabulary; the protocol layer knows
nothing about streams or ids. Both halves of the **LLM protocol** live in this
package and are registered as a PAIR of plugins with the same id, `"llm"`:
`patchwork:worker` resolves to the WorkerSpec (`src/worker-spec.js`, served by the
host provider) and `patchwork:worker-client` resolves to `makeLLMClient`
(`src/client.js`, a factory `(session) => {generate}`). The transport defines that
convention and does the lookup: a tool calls `connectWorkerClient("llm", …)`, which
finds the client plugin in the registry, opens a session for `"llm"`, and returns
`makeLLMClient(session)`. The tool never names this package at build time; the two
halves ship in one doc and cannot drift. `src/client.js` is PURE (imports nothing)
and must stay so — it is the chunk a sandboxed tool loads. A second worker kind
(e.g. transcription) would register its own pair and reuse the transport unchanged.

## Config ownership — the LLM trust boundary

This is the part the generic transport can't provide, and the reason llm-host exists
as a host-realm package.

```
   CONFIG OWNERSHIP            CONFIG RESOLUTION + WORKER          CONSUMER
   (llm-host, host)            (llm-host worker-spec, host)       (chat)
   ------------------          ---------------------------        --------
   settings doc                ensureConfig(scope) -> CallConfig  names a scope
   picker UI (config tray)     drives worker.js via WorkerSpec    writes request frames
   apiKey lives here           apiKey injected here, never out    reads event streams
                                                                  reads ZERO config
```

The consumer never touches config. Everything config-derived is either resolved
host-side from the `scope` chat sends, or rides back on the generation stream (e.g.
the model label). So chat imports nothing from the LLM library, and no secret is
ever reachable from the sandbox.

`worker-spec.js`'s `resolveForFrame` is where this is enforced: config is resolved
from the frame's `scope` alone; a consumer-supplied `frame.config` is ignored (it
would let a tool pick the provider AND supply its own key, defeating host-side
resolution). The apiKey enters the worker call host-side via `callConfig` and is
never placed in a request or event frame.

## The LLM op vocabulary

The transport treats frames as opaque (it reads only `id` and the reserved
`op:"abort"`). The LLM defines this vocabulary on top:

```
  request  (consumer -> worker):  {id, op:"generate"|"predict"|"preload"|
                                   "score-tokens"|... , scope, system, tools,
                                   messages|text, sessionKey, ...sampling knobs}
  events   (worker -> consumer):  {id, type:"token"|"stats"|"prediction"|"status"|
                                   "model"|"result"|"error", ...}
                                   result / error are terminal; abort = readable.cancel()
```

`worker-spec.js`'s `handle` switches on `op`: `generate` (incl. a `builtin` branch
for the Chrome Prompt API, which runs in-realm with no worker), `predict`, the
analytical ops (`score-tokens`, `compute-importance`, …), and `preload`. The consume
half (`client.js`) handles `token` / `status` / `model` progress plus the `result` /
`error` terminals. These two lists are maintained by hand and must stay in step — a
mismatch is silent (a frame type the serve half emits that the consume half doesn't
handle is simply ignored).

## The two topologies

The generic mechanics of each — who answers the subscription, how streams are
transferred within a realm vs. across the boundary — are in the worker README. What
follows is only the LLM-specific detail.

### Topology A — isolation OFF (chat runs in the host realm)

Everything is one realm. chat calls `connectWorkerClient("llm")`: the host registry
resolves the `patchwork:worker-client` plugin (this package's entry, then the
`client-*.js` chunk), and the returned client opens a session on first generate. The
`patchwork-worker-provider` (an ancestor in the frame) answers directly and hands chat
the streams by transfer. The worker runs right there, in the host origin (model
cache, WebGPU, `fetch`).

```
  chat            worker-provider           llm-host worker-spec      worker.js
  ----            ---------------           -------------------      ---------
  connect ──────► answer subscribe ───────► serveWorkerSpec(spec)
                                            spec.open: ensureConfig  ──►  (reads settings doc)
                                              (settings warm)
                     ◄── {readable,writable} (transfer) ──
  write {op:generate,scope,system,tools,messages} ─────► spec.handle: callConfig(+apiKey)
                                            post to worker  ─────────► token / stats / model /
  read {type:model,label}  ◄──                                        result / error
  read {type:token,...}    ◄── (stream)
  read {type:result,...}   ◄── (terminal)
```

Opening the config picker: chat dispatches `patchwork:open-tool
{component:"llm-config-tray", scope, ...}`; the tray's document listener opens the
picker. No bridge involved.

### Topology B — isolation ON (chat runs inside the sandboxed iframe)

Same chat code, same `connectWorkerClient("llm")` call. The plugin registry is
mirrored into the iframe (every registry type, ungated — entries arrive with the boot
snapshot and as live `plugin-registered` pushes, and `loadWhenReady` waits for a late
one), so the lookup resolves in-sandbox: the iframe module loader fetches
`registry--@grjte--llm-host/dist/index.js` (descriptors only) and then the
`client-*.js` chunk — the ONLY llm-host code that enters the sandbox. The worker
can't run in the opaque-origin iframe (no shared model cache; the settings doc / API
key are denylisted), so the host answers and the streams are transferred **across
the boundary**. The three relays are generic (see ISOLATION.md); the LLM-specific
facts are:

- **Why the host must answer.** The two reasons are both LLM-shaped: the model cache
  / WebGPU device live in the host origin, and the settings doc + API key are
  host-only. A worker kind with neither constraint could in principle run
  in-boundary — the LLM cannot.
- **What crosses:** only the stream pair (plus the small setup messages). After the
  handoff, tokens flow iframe⇄host-worker directly over the transferred port; the
  bridge is involved only in *setup*. The API key never crosses — it is applied
  host-side inside `worker-spec.js`.
- **Opt-in:** `patchwork:worker-channel` in `shared-providers` enables the worker
  handoff, and `llm-config-tray` in `shared-tools` enables the open-tool relay for
  the picker. Without the first, the session's subscription is never claimed,
  `connectWorker` resolves null after its discovery backstop, and chat degrades.

```
  chat (iframe)      iframe providers-bridge  host providers-bridge   worker-provider / spec
  -------------      -----------------------  ---------------------   ----------------------
  connect ─────────► capture unclaimed sub
   (subscribe)       RPC {providers-bridge, ──────────────────────►  gate selector.type ∈
                          id, selector}                               shared-providers
                                                                      re-dispatch subscribe on host
                                                                      ◄ provider serves spec:
                                                                         ensureConfig(scope)+worker
                                              ◄ {type:"change", value:{readable,writable}}
                                                 (transfer, host port)
                     ◄ RPC {providers-bridge-change,
                            id, value} (TRANSFER across boundary)
   ◄ value handed to chat's session
  write {op:generate,...} ─────────────────────────────────────────► worker.js (host origin)
  read token/model/result ◄──────────────────── (streams flow iframe⇄host directly now)
```

Opening the config picker (isolation on): chat dispatches the same
`patchwork:open-tool`; the iframe forwards it over RPC, the host open-tool bridge
gates it on `component ∈ ALLOWED_OPEN_TOOLS` (`["llm-config-tray"]`), and
re-dispatches on the host element so the tray opens **in the host realm**. The picker
— with the settings doc + API key — always runs in the host; the iframe only
*triggers* it.

## Why @chee/patchwork-llm is NOT loaded in the iframe

chat imports only the transport (`@grjte/patchwork-worker/client.js`, a library
subpath baked by `@chee/patchwork-bundles`). What it then loads from THIS package —
through the registry, not an import — is `dist/index.js` (three plugin descriptors,
no top-level imports) and the `client-*.js` chunk (imports nothing). Neither pulls
in the LLM library. `patchwork-llm-*.js` and `worker-spec-*.js` are reachable only
from the `patchwork:worker` plugin's `load()`, which only the host-realm provider
ever calls. So the transformers.js runtime, the config code, and the API key never
enter the sandbox graph. Two invariants keep it that way: `src/client.js` must never
import `@chee/patchwork-llm` or `./worker-spec.js` (vite would pull the library chunk
into the client chunk's graph), and `src/index.ts` must keep everything behind
`load()`.

(The isolation registry marker is per package, so a sandboxed tool *could* fetch the
other chunks deliberately — as it could the old raw subpath. Nothing secret is in
the served files: the API key lives in the settings doc, which is denylisted.)

(How tool code and its automerge deps load in the iframe at all — the `registry--`
marker rewrite of the baked `automerge:` dep — is generic isolation machinery; see
ISOLATION.md, "Package registry in iframe".)

## Data flow + security summary

- **API key never leaves the host.** Stored in the settings doc (host-only,
  denylisted from the iframe), read only by `worker-spec.js` during `callConfig`, and
  injected into the worker call host-side. Never in a request frame (chat sends only
  `scope`) nor in any event frame.
- **Config is host-resolved from `scope`.** chat sends `{toolId, docId}`; the host
  reads the real provider/model/prompts/toolToggles. chat reads no config; the model
  *label* comes back as a `{type:"model"}` event frame.
- **Only streams cross the boundary** (plus the small setup messages). After handoff,
  tokens flow iframe⇄host-worker directly over the transferred port.
- **Two opt-ins gate the bridges:** `shared-providers` ∩ `ALLOWED_PROVIDERS`
  (includes `patchwork:worker-channel`) and `shared-tools` ∩ `ALLOWED_OPEN_TOOLS`
  (open-tool). Neither is on by default.
- **isolation stays generic** — it relays worker-channel, open-tool, and the registry
  source-rewrite; it imports nothing LLM-specific.

## Is this the pattern for other workers?

Yes, in this shape: **one package registers a `patchwork:worker` / `patchwork:worker-client`
pair under one id.** The serve half is a WorkerSpec; the consume half is a factory
`(session) => api`. Consumers call `connectWorkerClient(kind)` and never import the
package. The transport and the isolation bridges are untouched by a new kind.

The **library + `-host` split is specific to the LLM**, not part of the pattern. It
exists because `@chee/patchwork-llm` predates the transport and is also used directly
(same realm) by other tools, so its request preparation is shared rather than moved.
A worker built transport-first keeps compute, spec and client in one package.

## File map

```
  @grjte/patchwork-worker ............. the generic transport library (see its README)
  providers/src/WorkerProvider.ts ..... the host-realm provider that drives it
  @chee/patchwork-llm  worker.js ...... the compute worker; createWorker() constructs it
  @chee/patchwork-llm  config.js ...... settings doc + config resolution (ensureConfig,
                                        callConfig, the apiKey), + picker.js (the picker UI)
  @chee/patchwork-llm  request.js ..... prepareGenerate + buildGeneratePayload: request
                                        preparation shared by generate() and worker-spec
  @grjte/patchwork-worker client.js ... connectWorkerClient(kind): registry lookup of the
                                        paired worker-client plugin + openSession(kind)
  llm-host/src/worker-spec.js ......... makeLLMWorkerSpec: host policy (sampling-only
                                        overrides, system maps, toolToggles, host-side
                                        <tool_call> parsing) over the library's request
                                        preparation — the SERVE half of the protocol
  llm-host/src/client.js .............. makeLLMClient(session) → {generate} — the CONSUME
                                        half (pure; a lazy dist chunk resolved via the
                                        patchwork:worker-client plugin)
  llm-host/src/index.ts ............... registers llm-config-tray + the "llm" worker and
                                        worker-client plugins
  llm-host/src/LlmConfigTray.tsx ...... host config tray: picker + patchwork:open-tool listener
  chat/src/components/ChatRoot.tsx .... connectWorkerClient("llm") → client.generate();
                                        /model dispatches patchwork:open-tool
  isolation/src/bridges/providers-bridge.ts  host + iframe halves of the provider relay,
                                        incl. worker-channel and its transferred streams
  isolation/src/bridges/open-tool-bridge.ts  host + iframe halves of the open-tool relay
  isolation/src/bridges/registry-bridge.ts   marker mapping + served-source dep rewrite
  threepane/src/PatchworkFrame.tsx .... mounts worker-provider + config tray
  threepane/src/components/IsolatedDocumentArea.tsx  sets shared-providers/shared-tools
```

## Build / sync

Bundled with vite + `@chee/patchwork-bundles` (the `automerge:`→cross-origin rewrite
for its `@chee/patchwork-llm` dep). `pnpm build`, then `pushwork sync`.
