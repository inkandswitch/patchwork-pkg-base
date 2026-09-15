# @grjte/patchwork-worker

Run a worker in the host realm and hand any consumer a transferable stream pair —
the same code inside or outside a Patchwork isolation boundary.

```js
// consumer (may be inside the sandbox)
import { openSession } from "@grjte/patchwork-worker/connect.js";
const session = openSession("llm", { element });
const { promise } = session.request(
  { op: "generate", messages },
  {
    terminal: {
      result: (f) => f.text,
      error: (f) => {
        throw new Error(f.message);
      },
    },
    onFrame: (f) => f.type === "token" && ui.append(f.delta),
  }
);
```

```js
// a package that owns a worker — declarative, nothing imported until first use
export const plugins = [
  {
    type: "patchwork:worker",
    id: "search-index",
    name: "Search Index",
    async load() {
      return makeWorkerSpec();
    },
  }, // -> WorkerSpec {createWorker, open?, handle, abort?}
];
```

The package is service-agnostic: it knows how to run _a_ worker in the host and
stream to _a_ consumer, and nothing about what any particular worker computes. A
concrete service (an LLM, a transcription engine, a search indexer) plugs in
through the **plugin registry**: it registers a plugin of type `patchwork:worker`
whose `id` names the worker `kind` and whose `load()` resolves to a **WorkerSpec**.
That registration is the whole coupling — the host provider (the
`patchwork-worker-provider` component, shipped by the `providers` package)
discovers workers by looking them up in the `patchwork:worker` registry by
`kind`, so a consumer that connects to `"llm"` reaches whatever package
registered a `patchwork:worker` plugin with `id: "llm"`. Nothing is imported
until a consumer actually connects.

This package is a plain library: it registers no plugins and is consumed as a
dependency, never installed as a module.

For the LLM service built on top of this — its op vocabulary, config/secret
handling, and how it behaves in each topology — see
[`../../llm-host/README.md`](../../llm-host/README.md).

## Why this exists

A Web Worker normally runs in the realm of the tool that constructed it. If a tool runs inside a
`null`-origin iframe, such as the Patchwork isolation package uses, then it
has no shared model cache, no WebGPU device the host set up, and — crucially — no
access to host-only state a worker may need (a settings doc, an API key), which is
deliberately denylisted from the sandbox.

So instead of constructing the worker in the tool's realm, this package runs it in
the **host realm** and transfers only its `{readable, writable}` stream pair to the
consumer. The worker (and anything host-only it resolves) never leaves the host;
only structured-cloneable frames cross. Because the consumer's code is just "open a
connection, write request frames, read event frames," it is **identical in and out
of isolation** — the only difference is who answers the connection request and
whether the streams are transferred within one realm or across the boundary.

## The three roles

```
  worker owner (host realm)                     consumer (any realm)
  -------------------------                     --------------------
  {type:"patchwork:worker",                     const {readable, writable, disconnect}
   id:"llm", load: () => spec}                    = await connectWorker("llm", req, {element})
    spec = {createWorker, open?, handle, abort?}
      → serveWorkerSpec(spec, req, {element})
         -> {readable, writable}

                     writable  <--- request frames {id, op, ...} ----   (consumer writes)
                     readable  ---- event frames {id, type, ...} --->   (consumer reads)
```

- **The consumer** calls `connectWorker(kind, request, {element})` (or the
  higher-level `openSession(kind)` for request/response multiplexing) and gets a
  stream pair. This is the only part a sandboxed tool runs, and the only file it
  loads (`connect.js`).
- **The provider** (`patchwork-worker-provider`, a `patchwork:component` shipped
  by the sibling `providers` package and mounted by the host frame) answers the
  connection request: it looks up `kind` in the `patchwork:worker` plugin
  registry — i.e. finds the registered plugin whose `id` equals `kind` — loads
  its `WorkerSpec`, and hands that to `serveWorkerSpec`, which it imports from
  `@grjte/patchwork-worker/serve.js`.
- **`serveWorkerSpec`** owns everything kind-agnostic: the stream pair and its
  controller lifecycle, **one dedicated worker per connection** (terminated on
  teardown — no sharing, no reuse), request-id demux, the reserved `op:"abort"`,
  and a bounded `open` warm-up. The spec supplies only the service's op vocabulary.

### The paired client plugin

A service package usually also owns the *consume* half of its protocol — the code
that turns `generate(...)` into request frames. Rather than have every tool import
that code from the service package (a build-time dependency on a registry
package, which the repo rules forbid), the package registers it as a second
plugin with the **same id** as its worker:

```js
export const plugins = [
  {type: "patchwork:worker",        id: "llm", load: () => spec},               // serve half
  {type: "patchwork:worker-client", id: "llm", load: () => (session) => api},  // consume half
];
```

A consumer then calls, from `@grjte/patchwork-worker/client.js`:

```js
const llm = await connectWorkerClient("llm", {sessionOpts: {idPrefix: "chat"}});
await llm.generate(messages, {element, ...});
```

`connectWorkerClient` resolves the `patchwork:worker-client` plugin for the kind
from the registry (bounded wait, so a missing service rejects instead of hanging),
opens a session for the same kind, and returns `factory(session)`. Both halves of
the protocol ship in one package and cannot drift; the tool's only tie to the
service is the kind string. Under isolation the registry is mirrored into the
iframe, so the same call works in both realms.

## The WorkerSpec contract

A service implements this; `serveWorkerSpec` drives it.

```
  createWorker()          construct the compute Worker. Typically stays in the
                          service's own library, because
                          new URL("./worker.js", import.meta.url) must resolve
                          against that module's URL. Called at most once per
                          connection, lazily, on the first frame that needs it.

  open(ctx)?              per-connection warm-up (e.g. resolving a settings doc).
                          ctx = {element} — the provider's mount point, so the
                          worker can reach host-realm context without the transport
                          knowing about it. BOUNDED by the transport (a 5s race):
                          a never-settling open can't wedge frames forever, so the
                          spec must make falling-through safe. Its resolved value
                          reaches handle as `io.state`.

  handle(frame, io)       turn ONE consumer request frame into worker traffic.
                          Everything service-specific lives here. May return an
                          opaque abort token, stored per request.
                          io = {post, emit, on, workerId, state, ctx}
                            post(msg, transfer?)  send to the worker
                            emit(frame)           enqueue a frame onto the consumer's
                                                  readable (auto-tagged with the
                                                  caller id)
                            on(fn)                handle worker messages for this
                                                  request; return truthy from fn when
                                                  the request is complete
                            workerId              the id to tag worker payloads with
                            state                 whatever open() resolved (or null)

  abort(token, post)?     cancel one in-flight request — the spec sends whatever
                          worker-specific payload stops it. Reached via the reserved
                          transport op {id, op:"abort"}, which session.js sends.
```

`serveWorkerSpec` owns the id lifecycle so an `op:"abort"` that races in while a
request is still being set up is honoured once its token lands, rather than being
dropped.

## Frames

Frames are **opaque to this package** — any structured-cloneable object. The
transport only reads `frame.id` (to demux) and `frame.op === "abort"` (the one
reserved op). Everything else is the service's own vocabulary. A connection is
multiplexed by `id`, so one stream pair can carry many overlapping requests:

```
  request  (consumer -> worker):  {id, op, ...service-specific...}
  events   (worker -> consumer):  {id, type, ...service-specific...}
                                  a service marks its own terminal frame types;
                                  abort is {id, op:"abort"} (reserved)
```

## Discovery + handoff go through patchwork-providers

The worker channel is an ordinary `patchwork:subscribe` whose `kind` is the `id` of
a registered `patchwork:worker` plugin. The consumer calls `subscribe()`; the
provider answers with `accept()`; the stream pair rides back in the value with the
streams named in the transfer list (**moved, not cloned** — a `ReadableStream`
can't be structured-cloned). It is the same relay as any other provider — a worker
connection is just a subscription whose value happens to carry transferred streams.

```
  consumer                                                    answering side
  --------                                                    --------------
  subscribe(el, {type:"patchwork:worker-channel",  ────────►  (mounted provider element
                 kind, request})                               answers via accept())
                                                              serveWorkerSpec(spec) -> streams
  listener({readable, writable})                  ◄─────────  respond({readable,writable},
    (streams TRANSFERRED, not cloned)                           [readable,writable])  // TRANSFER
```

Because it is an ordinary provider subscription and the streams are transferable, a
consumer's code is the same whether the provider that answers is in its own realm or
across an isolation boundary — the transport doesn't know or care which. How
isolation relays this subscription (and what gates it) is documented by the
isolation package.

If nothing answers, `connectWorker` resolves **`null`** — either a provider claimed
the subscription and answered a `null` value (an explicit refusal), or the bounded
discovery wait expired unclaimed. There is deliberately **no local-worker
fallback**: if a consumer could construct its own worker when discovery failed, a
tool that imports a service package would register that package's worker as an
import side-effect and silently serve itself, defeating the point of running the
worker in the host. A consumer treats `null` as "worker unavailable" and degrades.

## Files

- `connect.js` — the consumer transport: `connectWorker` (discovery + handoff) and
  `openSession` (request/response multiplexing over the pair). **The only file a
  sandboxed tool loads.**
- `session.js` — `openSession` internals: id tagging, demux, abort, reconnect.
- `serve.js` — `serveWorkerSpec`: streams, per-connection worker, id demux, abort.
  The serve half, imported by the host provider as
  `@grjte/patchwork-worker/serve.js`.
- `client.js` — `connectWorkerClient`: resolves the paired
  `patchwork:worker-client` plugin from the registry and binds its factory to
  `openSession(kind)`. Imports `@inkandswitch/patchwork-plugins` statically and is
  therefore **not re-exported from index.js** (see below); consumers import the
  subpath `@grjte/patchwork-worker/client.js`.
- `index.js` — barrel over connect.js plus the `WORKER_PLUGIN_TYPE` /
  `WORKER_CLIENT_PLUGIN_TYPE` strings. No `plugins` array: this package is a
  library, not a module. Its static graph must stay free of
  `@inkandswitch/patchwork-plugins`, because the module loader evaluates package
  entries in a Worker where that import cannot resolve — `connect.test.js`
  enforces this.

## ⚠ Nothing in this package may hold host-only state or secrets

`connect.js` is fetched into the sandbox, and the isolation registry marker is per
package, so an isolated tool can reach any file here. Any host-only state or secret a
worker needs therefore lives in that worker's own service package (for the LLM, the API
key lives in the settings doc that `@grjte/llm-host` resolves — see its `README.md`), and
the host-realm provider that runs workers lives in the `providers` package. This package
holds no state and imports nothing service-specific. `client.js` touches only the plugin
registry (descriptors and lazy loaders); the factory it returns is the *service package's*
code, fetched by the same loader that fetches any tool.
