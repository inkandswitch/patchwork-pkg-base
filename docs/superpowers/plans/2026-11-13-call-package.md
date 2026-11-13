# call package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone `call/` package in patchwork-pkg-base (provider, doc-title button, control panel, video tab, face) that lets anyone call on any doc, and the threepane changes that host it.

**Architecture:** lattice's call engine (`wm/call/*`) is ported into `base/call/src/engine/`, with its project-shaped API replaced by url-keyed rooms. All five plugins import that one engine as a shared chunk. Anything outside the package talks to the provider through `patchwork:call` events and three `patchwork:subscribe` selectors, plain data only. threepane mounts the provider outermost, renders the control panel by component id, gives sidebar widgets `fill`/`fit`/`none` sizing, and opens the video tab when asked.

**Tech Stack:** vanilla JS + `solid-js` / `solid-js/html` (no JSX), vite bundle with bootloader externals and `vite-plugin-css-injected-by-js`, vitest + happy-dom, `@inkandswitch/patchwork-providers` for `subscribe`/`accept`. threepane stays TSX + esbuild.

**Spec:** `docs/superpowers/specs/2026-11-12-call-package-design.md`. Read it before any task. The plan argues from it.

**Source being ported:** `../lattice.patchwork.inkandswitch.com/packages/wm/call/`, `.../wm/{lasting,kept,pointer,presence}.js`, `.../wm/ui/{icons,along,arriving}.js`, `.../wm/vendor/deepfilternet/`, `.../lattice/call-bar.js`, and the call rules in `.../wm/wm.css` and `.../lattice/shell.css` (grep `lattice-wm-call`, `lattice-call`, `lattice-wm-menu`). Nothing in lattice is edited.

**Branch:** work in base on a branch `call-package` (base is on `main`; leave any unrelated uncommitted changes alone and stage only the files each task names).

## Global Constraints

- Standalone package rules (base `AGENTS.md`): own `package.json`, `pnpm-lock.yaml` (committed), `pnpm-workspace.yaml` (committed, copied verbatim from a neighbour), `vitest.config.js` with `passWithNoTests: true`, `.gitignore` = `dist`, `node_modules`, `.pushwork`; no `workspace:`/`catalog:`/`link:`/`file:` specifiers; `pnpm lint` at the base root passes.
- No build-time coupling: threepane never imports from `call/`, and `call/` never imports from threepane. They meet by component id, tags, events and DOM attributes.
- Entry module (`src/index.js`) is parsed in a worker: plugin entries are metadata only, all code behind `load()` via dynamic `import()`, no bare external imports in its static graph.
- CSS: every class namespaced `patchwork-call-…`; colour/font tokens derived once in `@layer package { :root, :host, [theme] { --call-…: var(--studio-…) } }` (these are all studio chrome: sidebars, title bar, floating layer), style rules unlayered, no hex colours, no `prefers-color-scheme`. Import CSS from tool modules, never the entry.
- Ephemeral wire key stays `"lattice-wm:call"`. Settings stay in localStorage under `"lattice-wm:call"` (minus `cursors`). DeepFilterNet's IndexedDB name stays `"lattice-wm:deepfilternet"`. Page-lifetime `lasting` keys and the sessionStorage rejoin key become `"patchwork-call:…"` so they never collide with a lattice copy.
- A room id is a bare document url (`automerge:<id>`, found in the page repo: `globalThis.repo ?? globalThis.patchwork?.repo`) or `key:<64 lowercase hex>`. Key rooms are designed for but not built: their channel opens to nothing.
- One call per tab, ever.
- The control panel takes no sidebar space when you're not in a call and no call is heard on screen.
- No media streams cross the protocol.
- Isolation mode is out of scope.

## Review Focus

1. **Mounted events not reaching the provider.** A doc opened deep inside threepane (inside the draft-overlay, comments and focus providers) must still be heard by the outermost `call-provider`. Expect a call on it to show in the control panel. Pinned by a provider test dispatching `patchwork:mounted` from a nested element (Task 4), and by the browser check (Task 11).
2. **The same doc mounted several times.** Title-bar tools, the editor and an embed all mount the same url. When one of them unmounts, hearing must carry on, and only the last unmount stops it. Pinned in Task 4.
3. **Draft and heads urls.** `automerge:<id>#<heads>`, `automerge:<id>/path` and the plain url are one room. Pinned by `roomUrl` tests (Task 2) and a provider test mounting a heads url (Task 4).
4. **Rejoin scope after reload.** Rejoin happens only when the remembered room comes back on screen (mounted or declared) within `REJOIN_WITHIN`. A room heard only because a button subscribed to it must not rejoin. Pinned in Task 3.
5. **The call package missing.** threepane still renders, the frame isn't blank, nothing waits on `call-provider`, and the doc-title button renders nothing when no provider answers. Pinned in Task 8 (button) and Task 9 (threepane).

---

### Task 1: Package scaffold and the pure modules

**Files:**
- Create: `call/package.json`, `call/pnpm-workspace.yaml` (copy `comments-view/pnpm-workspace.yaml`), `call/.gitignore`, `call/vite.config.js`, `call/vitest.config.js`, `call/src/index.js`
- Create (copied from wm, unchanged unless noted): `call/src/engine/lasting.js` (symbol becomes `Symbol.for("patchwork-call:lasting")`), `call/src/engine/kept.js`, `call/src/engine/rejoin.js` (`REJOIN_KEY = "patchwork-call:rejoin"`; import `./kept.js`), `call/src/engine/sizes.js`, `call/src/engine/wiggle.js`
- Test: `call/test/sizes.test.js`, `call/test/wiggle.test.js`, `call/test/kept.test.js` (the `kept:` and `rejoin:` cases of wm's `kept.test.js`; drop the `following:` ones), `call/test/lasting.test.js`

**Interfaces:**
- Produces: `lasting(key, make)`, `kept(key, fallback?, storage?)`, `keep(key, value, storage?)`, `keepCall`/`leavingCall`/`forgetCall`/`callToRejoin`/`REJOIN_WITHIN` exactly as in wm. `sizes.js` and `wiggle.js` exports unchanged.
- `package.json`: `"name": "@tiny-patchwork/call"`, `"type": "module"`, `"private": true`, `"main": "./dist/index.js"`, scripts `build: vite build`, `dev: vite build --watch`, `sync: vite build && pushwork sync`, `register` (as comments-view), `test: vitest run`, `test:watch: vitest`. Deps at comments-view's versions: `@automerge/automerge`, `@automerge/automerge-repo`, `@inkandswitch/patchwork-filesystem`, `@inkandswitch/patchwork-plugins`, `@inkandswitch/patchwork-providers`, `solid-js`. Dev deps: `@inkandswitch/patchwork-bootloader`, `happy-dom`, `vite`, `vite-plugin-css-injected-by-js`, `vitest`.
- `vite.config.js`: comments-view's config without `vite-plugin-solid`, with `input: "./src/index.js"`.
- `vitest.config.js`: `environment: "happy-dom"`, `globals: true`, `passWithNoTests: true`, `resolve.conditions: ["development", "browser"]`.
- `src/index.js`: `export const plugins = []` for now. Each later task adds its entry.

- [ ] **Step 1: Copy the four test files over, switching `node:test` to vitest.** Change `import { test } from "node:test"` (or the default import) to `import { test } from "vitest"`, keep `node:assert/strict`, and fix the import paths to `../src/engine/…`. For `lasting.test.js`, also update the key it checks if it asserts the symbol.
- [ ] **Step 2: Run `pnpm install && pnpm test` in `call/`.** Expected: FAIL, because the engine modules don't exist yet.
- [ ] **Step 3: Copy the five engine modules over** with the two key changes listed above.
- [ ] **Step 4: Run `pnpm test`, then `pnpm build`, then `pnpm lint` at the base root.** Expected: tests PASS, the build writes `dist/index.js`, lint reports nothing for `call/`.
- [ ] **Step 5: Commit** (`git checkout -b call-package` first) with the message `call: scaffold package, port pure modules from lattice`.

### Task 2: Room ids, channels and room names

**Files:**
- Create: `call/src/engine/room.js`, `call/src/engine/channel.js`
- Test: `call/test/room.test.js`, `call/test/channel.test.js`

**Interfaces:**
- Produces:
  - `roomUrl(url: unknown): string | null`. This is the room id normaliser (the name stays `roomUrl` because the protocol calls its fields `url`). For an automerge url it returns `automerge:<documentId>`, with any `#…` fragment and `/…` path removed. For `key:<hex>` it returns the same, lowercased, if the hex is exactly 64 characters. Anything else, including an automerge url that isn't valid once trimmed (`isValidAutomergeUrl` from `@automerge/automerge-repo/slim`), returns `null`.
  - `keyRoom(bytes: Uint8Array): string`. This returns `key:` plus the 32 bytes as hex, and throws `RangeError` unless `bytes.length === 32`.
  - `isKeyRoom(id: string): boolean`.
  - `pageRepo(): Repo | null`. This returns `globalThis.repo ?? globalThis.patchwork?.repo ?? null`.
  - In `channel.js`, `openChannel(id: string): Promise<Channel | null>`, where `Channel = { id: string, on(fn: (event: { message: unknown, senderId: string }) => void): void, off(fn): void, send(message: object): void }`. For a doc room it awaits `pageRepo().find(id)` (cached per id) and wraps the handle: `on` and `off` go through `handle.on/off("ephemeral-message")`, passing `{ message: e.message, senderId: String(e.senderId) }`, and `send` is `handle.broadcast`. A key room, no repo, or a failed `find` all resolve to `null` (log a warning for the failed find).
  - `titleOf(handle: DocHandle): Promise<string>`. This reads `doc["@patchwork"]?.type`, loads that datatype with `getRegistry("patchwork:datatype")`, and returns its `getTitle(doc)`. It falls back to `doc.title`, then `""`, and never throws.

- [ ] **Step 1: Write the failing tests.**
  - `roomUrl("automerge:2j9…")` returns itself.
  - The same id with `#heads|abc` returns the bare url, and so does the same id with `/path/to`.
  - `roomUrl("")`, `roomUrl(null)` and `roomUrl("https://x")` return `null`.
  - `pageRepo()` returns `globalThis.repo` when it's set, `globalThis.patchwork.repo` when only that is set, and `null` otherwise. Restore the globals after each test.
  - `roomUrl("KEY:" + "AB".repeat(32))` returns `"key:" + "ab".repeat(32)`, and a 63-character hex returns `null`. `keyRoom(new Uint8Array(32).fill(255))` returns `"key:" + "ff".repeat(32)`, and `keyRoom(new Uint8Array(31))` throws.
  - In `channel.test.js`, `openChannel` for a doc url with a fake repo: `send({a:1})` calls `handle.broadcast({a:1})`, and a listener added with `on` gets `{ message, senderId }` when the fake handle emits. `openChannel("key:" + "00".repeat(32))` resolves to `null`, and so does a doc url when there's no repo.
  - `titleOf` with a mocked `@inkandswitch/patchwork-plugins` (`vi.mock`, registry `load` resolving `{ getTitle: (d) => "T:" + d.x }`) returns `"T:1"` for `{ "@patchwork": { type: "t" }, x: 1 }`. When `load` rejects, it returns `doc.title`.
- [ ] **Step 2: Run `pnpm test room`.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement `room.js` and `channel.js`.**
- [ ] **Step 4: Run `pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit** with the message `call: room urls and names`.

### Task 3: The engine, ported and re-keyed by url

**Files:**
- Create (copied from wm, then changed): `call/src/engine/call.js`, `call/src/engine/noise.js` (imports `./lasting.js` and `../vendor/deepfilternet/deepfilternet.js`; the IndexedDB name stays the same), `call/src/engine/speaking.js`, `call/src/engine/face.js`, `call/src/vendor/deepfilternet/*` (all three files, LICENSE included)
- Test: `call/test/call.test.js`

**Interfaces:**
- Consumes: Task 1's modules, plus `roomUrl`, `isKeyRoom`, `openChannel` and `titleOf` (Task 2). The engine never touches a `DocHandle`. Every `room.on/off("ephemeral-message")` and `room.broadcast` in wm's code goes through a `Channel`, and `event.senderId` comes from the channel's event.
- Produces (everything else that wm's `call.js` exports stays, with the same signature: `FACES`, `setNoise`, `hangUp`, `setMic`, `setCamera`, `setDevice`, `devices`, `setFloating`, `hideFloating`, `showFloating`, `canShare`, `startScreen`, `stopScreen`, `toggleStage`, `showStage`, `setFull`, `closeStage`, `onCallIn`):
  - `export const KEY = "lattice-wm:call"`.
  - `hearRoom(url: string, opts?: { onScreen?: boolean, name?: string }): () => void`. This normalises with `roomUrl` and keeps refcounts per url, separately for all sources and for `onScreen` sources. On the first source for a url, it opens the channel, attaches the old `hearCalls` listener, and sends `{ [KEY]: "hello" }`. A `null` channel makes it a no-op that still returns a working release. A `name` is kept while the source that gave it is held. The returned function releases this one source, and the last release detaches the listener. When `onScreen` goes from 0 to ≥1, there's no session, and `callToRejoin(url)` gives something back, it calls `forgetCall()`, then `join(url, { video: back.camera })`, and then `setMic(false)` if `!back.mic`.
  - `join(url: string, opts?: { video?: boolean }): Promise<void>`. Same body as wm's, but the room is a `Channel` from `openChannel(roomUrl(url))`, and `state.call.name` comes from `call.nameOf(url)`. When the channel is `null`, no session starts and `call.problem()` returns `"calls over a key aren't available yet"` for a key room, or `"couldn't reach that doc"` otherwise. `call.problem()` is a new accessor for a problem outside a call, cleared on the next `join`.
  - `ask(url: string, opts?: { at?: { x: number, y: number } | null }): void`. This sets `asking` to `{ url, at }`.
  - `holdVideoSpot(): () => void`. A refcount of frames that can show `call-video`.
  - `setFaces("floating" | "sidebar")`. It's ignored for `"sidebar"` unless `call.canShowVideo()`.
  - On the `call` object:
    - **Removed:** `cursors`, `current`.
    - **Kept:** `get`, `peers`, `stream`, `screen`, `local`, `me`, `settings`, `floatKey`, `asking`, `stopAsking`, `stage`, `full`.
    - **Changed:** `find({ peer, contact })` matches by peer, else by contact, as before. `mode()` returns `"sidebar"` only when `settings.faces === "sidebar" && call.canShowVideo()`, and `"floating"` otherwise.
    - **New:** `rooms()` returns `[{ url, name, others }]` for each url whose `onScreen` count is above 0, that has `onCallIn(url).length > 0`, and that isn't `state.call?.room`. `nameOf(url)` returns the held name if there is one, else the title from `titleOf` once it's resolved, else `""`. `canShowVideo()` is true when the video-spot count is above 0. `videoWanted()` is `!!state.call && call.mode() === "sidebar"`.
  - Removed exports: `inProject`, `setCursors`, and `hearCalls` (it becomes internal).
- Other changes inside the file:
  - Drop the `presence.js` import.
  - The session's `onMessage` answers both `message[KEY] === "hello"` and `message["lattice-wm:hello?"]` with the delayed `sayHere`, as the `HELLO` branch does today.
  - Drop `cursors` from `readSettings`/`saveSettings`.
  - Rename the `lasting` keys to `"patchwork-call:state"`, `"patchwork-call:session"` and `"patchwork-call:view"`.

- [ ] **Step 1: Write the failing tests.** Use a fake handle `{ url, on, off, broadcast: vi.fn(), doc: () => ({}) }` and `globalThis.repo = { find: async () => handle }`.
  - `hearRoom` broadcasts `{ "lattice-wm:call": "hello" }` once, even when there are two sources.
  - After an ephemeral `{ "lattice-wm:call": "here", from: "x", who: { name: "ana" } }`, `onCallIn(url)` has one entry, and `call.rooms()` lists the url only while an `onScreen` source is held.
  - Releasing one of two sources keeps the listener (`off` not called), and releasing the last one calls `off`.
  - `hearRoom("automerge:<id>#h")` and `hearRoom("automerge:<id>")` share one listener.
  - `hearRoom(keyRoom(bytes))` doesn't throw, and its release doesn't either. `join(keyRoom(bytes))` leaves `call.get()` `null`, with `call.problem()` `"calls over a key aren't available yet"`.
  - `nameOf(url)` returns the held name, and falls back to the title once there's no held name.
  - `setFaces("sidebar")` leaves `mode()` at `"floating"` until `holdVideoSpot()` is held. After that it's `"sidebar"`, and it goes back to `"floating"` when the spot is released, with `settings.faces` still `"sidebar"`.
  - Rejoin with a remembered call (`keepCall` on a stub storage, `leavingCall`) and `join` spied: an `onScreen` source triggers a join, and a source without `onScreen` doesn't.
  - Mock `navigator.mediaDevices` and `RTCPeerConnection` minimally, or spy on `join`, so `join` doesn't touch media.
- [ ] **Step 2: Run `pnpm test call`.** Expected: FAIL.
- [ ] **Step 3: Copy the engine over and make the changes listed above.**
- [ ] **Step 4: Run `pnpm test`, then `pnpm build`.** Expected: PASS. Check that `dist/` contains `deepfilternet-worklet-processor.js` as an emitted asset, since the vendor loads it with `new URL(…, import.meta.url)`. If vite inlines or drops it, add it via `build.rollupOptions` or `assetsInclude` until it's emitted.
- [ ] **Step 5: Commit** with the message `call: port the engine, rooms keyed by url`.

### Task 4: The provider and the protocol

**Files:**
- Create: `call/src/protocol.js`, `call/src/provider.js`
- Modify: `call/src/index.js` (add the `call-provider` entry)
- Test: `call/test/provider.test.js`

**Interfaces:**
- Consumes: `hearRoom`, `ask`, `hangUp`, `holdVideoSpot`, `call`, `onCallIn` (Task 3), `roomUrl` (Task 2). `accept` from `@inkandswitch/patchwork-providers`.
- Produces:
  - `protocol.js`: `CALL_EVENT = "patchwork:call"`, `CALL = "patchwork:call"`, `CALL_ROOM = "patchwork:call-room"`, `CALL_VIDEO = "patchwork:call-video"`, and `roomState(url): { here: boolean, others: number, elsewhere: boolean }`. `here` is `call.get()?.room === url`, `others` is `onCallIn(url).length`, and `elsewhere` is `!!call.get() && !here`.
  - `provider.js`: `export function CallProvider(element: HTMLElement): () => void`. On `element` it listens for:
    - `patchwork:mounted` / `patchwork:unmounted`: when `"url" in detail`, it calls `hearRoom(url, { onScreen: true })` and its release, refcounted per normalised url and keyed per event. It does nothing for `componentId` details.
    - `patchwork:subscribe`, three selectors, each answered with `accept`:
      - `CALL {url}`: calls `hearRoom(url)` and answers with `roomState(url)` on every change.
      - `CALL_ROOM {url, name}`: calls `hearRoom(url, { onScreen: true, name })` and answers the same way.
      - `CALL_VIDEO`: calls `holdVideoSpot()` and answers with `{ wanted: call.videoWanted() }` on every change.
      - Each teardown releases what it took. Answers come from a Solid `createRoot` + `createEffect` disposed on teardown, so only changes are posted.
    - `CALL_EVENT` (detail `{ action: "ask" | "hang-up", url?, at? }`): `"ask"` calls `ask(roomUrl(url), { at })`, and `"hang-up"` calls `hangUp()`. Anything else is ignored.
  - The full-window layer is added in Task 6. For now, cleanup removes every listener and releases every source.
  - Entry: `{ type: "patchwork:component", id: "call-provider", name: "Call", async load() { return (await import("./provider.js")).CallProvider } }`.

- [ ] **Step 1: Write the failing tests.** Use real `subscribe` from `@inkandswitch/patchwork-providers` against a mounted provider element, with the fake repo and handle from Task 3.
  - A `patchwork:mounted` with `{ url, toolId }` dispatched from a grandchild of the provider element (bubbling, composed) makes `hearRoom` hear it. Check with a `here` message, then `call.rooms()`.
  - Mounting the same url twice and unmounting once still hears it, and the second unmount stops it.
  - Mounting `url#heads` and unmounting the bare `url` balances out.
  - `subscribe(el, { type: "patchwork:call", url })` first gets `{ here: false, others: 0, elsewhere: false }`, then `others: 1` after a `here` message.
  - `subscribe(el, { type: "patchwork:call-room", url, name: "proj" })` makes `call.nameOf(url)` return `"proj"` and `call.rooms()` list the room. Unsubscribing removes both.
  - `subscribe(el, { type: "patchwork:call-video" })` gets `{ wanted: false }`, and while it's held, `call.canShowVideo()` is true.
  - Dispatching `new CustomEvent("patchwork:call", { bubbles: true, detail: { action: "ask", url, at: { x: 1, y: 2 } } })` makes `call.asking()` deep-equal `{ url, at: { x: 1, y: 2 } }`.
  - After cleanup, a further `patchwork:mounted` is ignored.
- [ ] **Step 2: Run `pnpm test provider`.** Expected: FAIL.
- [ ] **Step 3: Implement `protocol.js`, `provider.js` and the entry.**
- [ ] **Step 4: Run `pnpm test && pnpm build && pnpm lint`.** Expected: PASS. In `dist/index.js` (the entry chunk), check that there is no bare `import` of `solid-js` or `@inkandswitch/*` at top level.
- [ ] **Step 5: Commit** with the message `call: provider and protocol`.

### Task 5: UI pieces, styles, and `call-face`

**Files:**
- Create: `call/src/ui/icons.js` (only `close`, `mic`, `mic-off`, `minimise`, `screen`, `video`, `video-off`, `phone`, `hang-up`, `chevron-down`, and `check` if used), `call/src/ui/along.js`, `call/src/ui/arriving.js`, `call/src/ui/colour.js` (`colourFor` from `pointer.js`), `call/src/ui/avatar.js` (`faceImage` from `presence.js`, with the same lazy `patchwork-filesystem` import), `call/src/ui/faces.js` (`names`, `Face`, `Screen`, `DragOut`, `StageButton`, `initial`, `videoOf`, copied from `wm/call/ui.js`), `call/src/ui/styles.css`, `call/src/call-face.js`
- Modify: `call/src/index.js` (add the `call-face` entry)
- Test: `call/test/faces.test.js`

**Interfaces:**
- Consumes: `call`, `centreOn`, `hearing` and `wiggle` from the engine.
- Produces:
  - `Face(props: { id: "me" | string, size?: number /* px */, shape?: "round" | "tile", muted?: boolean, title?: boolean })`. Same rendering as wm's, but the size goes to `--call-face-size: <n>px` (no `--lattice-px`), and every class `lattice-wm-call-*` becomes `patchwork-call-*`.
  - `call-face.js`: `export function CallFace(element: HTMLElement): () => void`. It reads the `peer`, `contact`, `size` (px number) and `no-title` attributes, re-reading them through a `MutationObserver` on those four. It renders `Face` for `call.find({ peer, contact })?.id`, and nothing when there's no match.
  - `styles.css`: the call rules from `wm.css` and `shell.css`, renamed (`lattice-wm-call-*` and `lattice-call-*` to `patchwork-call-*`, `lattice-wm-menu*` to `patchwork-call-menu*`), with every `--lattice-*` colour or font replaced by a `--call-*` token derived in the `@layer package` block, per Global Constraints.
  - Entry: `{ type: "patchwork:component", id: "call-face", name: "Call face", async load() { return (await import("./call-face.js")).CallFace } }`.

- [ ] **Step 1: Write the failing tests.** `names(["a"])` returns `"a"`, `names(["a","b","c"])` matches wm's output, and so on, copying wm's expectations. Then `CallFace` on an element with `contact="automerge:c1"`:
  - With no call, it renders no `.patchwork-call-face`.
  - With a call whose `state.peers` has a peer with `contact: "automerge:c1"` (seeded through an exported test hook or the `here` path from Task 3's fake room), it renders one, with `--call-face-size` set to `44px` when `size="44"`, and with no `title` attribute when `no-title` is present.
  - Changing the `contact` attribute to someone absent removes the face.
- [ ] **Step 2: Run `pnpm test faces`.** Expected: FAIL.
- [ ] **Step 3: Implement the files and the entry.**
- [ ] **Step 4: Run `pnpm test && pnpm build`.** Expected: PASS. Grep `src/` for `lattice-` and expect it only in the wire, settings and IndexedDB keys.
- [ ] **Step 5: Commit** with the message `call: faces, styles, call-face`.

### Task 6: The floating layer: question, floating faces, stage

**Files:**
- Create: `call/src/ui/question.js` (`CallQuestion`, from `CallPrompt`), `call/src/ui/floating.js` (`CallFloating`), `call/src/ui/stage.js` (`CallStage`), `call/src/ui/area.js`
- Modify: `call/src/provider.js` (render the layer into `element`)
- Test: `call/test/layer.test.js`

**Interfaces:**
- Consumes: Task 5's `Face`/`Screen`/`DragOut`/`StageButton`, and the engine.
- Produces:
  - `area.js`: `stageArea(root: HTMLElement): Accessor<DOMRect | null>`. It tracks the first `[data-call-stage]` under `root`, using a `MutationObserver` on `root` for it appearing or going, plus a `ResizeObserver` on it and window `resize`. It's `null` when there's none.
  - `CallQuestion()`: shows only while `call.asking()` is set, as a `popover="auto"` placed at `asking().at` or else `{ x: 16, y: 16 }`, clamped as in wm. Its copy is wm's: "start a call here?" or "<names> on a call", then "share your video?", then "video on" / "just voice", then "not now". The foot reads "leaves the call in <name>" when you're in a call elsewhere, using `call.nameOf(thatRoom) || "another doc"`. Pressing a button calls `join(asking().url, { video })`. There's no arrival or `focus` logic. It focuses its first button when it opens.
  - `CallFloating(props: { area: Accessor<DOMRect | null> })` and `CallStage(props: { area: Accessor<DOMRect | null> })`. These are wm's, except that the start position and box come from `area()` and fall back to the window, and both use `popover="manual"` so they sit in the top layer.
  - The provider mounts `<div class="patchwork-call">` with the three inside it (Solid `render`), and disposes it in cleanup.

- [ ] **Step 1: Write the failing tests.**
  - With no asking, no `.patchwork-call-question` is open.
  - After `ask(url, { at: { x: 40, y: 50 } })`, it's open with `style.left === "40px"`, and with no call on, it says "start a call here?".
  - Clicking "just voice" calls a spied `join` with `(url, { video: false })` and clears `call.asking()`.
  - While in a call on another url with a held name `"other"`, the foot says "leaves the call in other".
  - `stageArea` returns the rect of an element given `data-call-stage` after it's added (with a stubbed `getBoundingClientRect`), and `null` after it's removed.
- [ ] **Step 2: Run `pnpm test layer`.** Expected: FAIL.
- [ ] **Step 3: Implement the files and wire them into the provider.**
- [ ] **Step 4: Run `pnpm test && pnpm build`.** Expected: PASS.
- [ ] **Step 5: Commit** with the message `call: question, floating faces and stage`.

### Task 7: The control panel and the video tab

**Files:**
- Create: `call/src/control-panel.js` (from `lattice/call-bar.js`), `call/src/video.js` (`CallTiles` from `wm/call/ui.js`)
- Modify: `call/src/index.js` (two entries)
- Test: `call/test/control-panel.test.js`, `call/test/video.test.js`

**Interfaces:**
- Consumes: the engine, and Task 5's UI pieces.
- Produces:
  - `export function CallControlPanel(element: HTMLElement): () => void`.
    - It sets `element.dataset.sidebarSize` to `"none"` when `!call.get() && call.rooms().length === 0`, and to `"fit"` otherwise.
    - **Not in a call:** it lists `call.rooms()`, one row each, showing the room's name (or "a doc"), "<names> on a call", and join buttons "video on" / "just voice" that call `join(url, { video })`. When you're in another call, that row also says "leaves the call in <name>".
    - **Going to the call's doc:** the room's name, both in a listed row and in the in-call head ("where the call is"), is a button. Pressing it calls `openDocument(element, url)` from `@inkandswitch/patchwork-elements`, which dispatches `patchwork:open-document` (bubbling, composed), so whatever frame it's in opens the doc. A frame whose room isn't a doc it opens directly, like lattice's project folder, can intercept that event. `@inkandswitch/patchwork-elements` goes in `package.json` at comments-view's version. It's on the importmap, so it stays external.
    - **In a call:** the `In` section of `call-bar.js`, renamed to `patchwork-call-panel-*`. The menu has faces "floating" / "in the sidebar", with "in the sidebar" listed only while `call.canShowVideo()`. Then mic and camera devices, then noise. There's no "on cursors" item.
  - `export function CallVideo(element: HTMLElement): () => void`: `CallTiles` while you're in a call, else `<p class="patchwork-call-video-none">no call</p>`.
  - Entries:
    - `{ type: "patchwork:component", id: "call-control-panel", name: "Call", async load() { return (await import("./control-panel.js")).CallControlPanel } }`
    - `{ type: "patchwork:component", id: "call-video", tags: ["context-tool"], name: "Call", icon: "Video", async load() { return (await import("./video.js")).CallVideo } }`

- [ ] **Step 1: Write the failing tests.**
  - The panel's `element.dataset.sidebarSize` is `"none"` at rest, becomes `"fit"` after a `here` message on an `onScreen` room, and goes back to `"none"` after that room is released.
  - The row shows the held name, and "video on" calls `join(url, { video: true })`.
  - Clicking the row's name dispatches a `patchwork:open-document` event with `detail.url === url` from inside the panel's element, caught by a listener on its parent. Clicking the in-call head's name does the same with the call's room url.
  - With a call on and the menu opened, there's no "in the sidebar" item until `holdVideoSpot()` is held, and no item containing "cursor" at all.
  - `CallVideo` shows "no call" out of a call.
- [ ] **Step 2: Run `pnpm test control-panel video`.** Expected: FAIL.
- [ ] **Step 3: Implement the two components and their entries.**
- [ ] **Step 4: Run `pnpm test && pnpm build`.** Expected: PASS.
- [ ] **Step 5: Commit** with the message `call: control panel and video tab`.

### Task 8: The doc-title button

**Files:**
- Create: `call/src/button.js`
- Modify: `call/src/index.js`
- Test: `call/test/button.test.js`

**Interfaces:**
- Consumes: only `protocol.js` constants and `subscribe` from `@inkandswitch/patchwork-providers`. **No engine import** (spec: it has to keep working from another realm).
- Produces:
  - `export default function CallDoctitleButton(handle: DocHandle, element: HTMLElement): () => void`.
  - It subscribes to `{ type: CALL, url: handle.url }`, and renders nothing until the first answer arrives.
  - It then renders a `<button class="patchwork-call-button" data-state="call"|"join"|"here">`:
    - `here` → label "hang up", icon `hang-up`, and pressing it dispatches `{ action: "hang-up" }`.
    - `others > 0` → label "join the call", icon `phone`, with the `others` count beside it.
    - otherwise → label "call everyone here", icon `phone`.
  - Pressing call or join dispatches `CALL_EVENT` (bubbling, composed) from `element`, with `{ action: "ask", url: handle.url, at: { x: rect.left, y: rect.bottom + 6 } }`.
  - It imports `./ui/styles.css` and `./ui/icons.js`.
  - Entry: `{ type: "patchwork:tool", id: "call-doctitle-button", tags: ["titlebar-tool"], name: "Call button", icon: "Phone", supportedDatatypes: "*", unlisted: true, forTitleBar: true, load: () => import("./button.js").then((m) => m.default) }`.

- [ ] **Step 1: Write the failing tests.** Use a host element answering `patchwork:subscribe` with `accept` from `@inkandswitch/patchwork-providers`, pushing states by hand.
  - With no answer, the element has no `button` (wait two ticks).
  - After `{ here: false, others: 0 }`, `data-state` is `"call"` with aria-label "call everyone here".
  - After `{ others: 2 }`, it's `"join"` and shows `2`.
  - After `{ here: true }`, it's `"here"`, and a click dispatches a `patchwork:call` event with `action: "hang-up"`.
  - In the `"call"` state, a click dispatches `action: "ask"` with `url === handle.url`.
- [ ] **Step 2: Run `pnpm test button`.** Expected: FAIL.
- [ ] **Step 3: Implement the button and its entry.**
- [ ] **Step 4: Run `pnpm test && pnpm build && pnpm lint`.** Expected: PASS.
- [ ] **Step 5: Commit** with the message `call: doc-title button`.

### Task 9: threepane: sidebar widget sizing, the control panel, the provider, and the stage area

**Files:**
- Modify: `threepane/src/components/SidebarWidgets.tsx`, `threepane/src/styles.css:680-701`, `threepane/src/datatypes.ts` (add `export const CALL_CONTROL_PANEL = "call-control-panel"` and `export const CALL_PROVIDER = "call-provider"`), `threepane/src/PatchworkFrame.tsx:181-186` (wrap the `<Show when={areProvidersReady()}>` inside the worker provider with `<patchwork-view component={CALL_PROVIDER}>`; don't add it to `areProvidersReady`), `threepane/src/components/DocumentAreaRoot.tsx` (add `data-call-stage` to the `.main-area` div)
- Test: `threepane/src/components/SidebarWidgets.test.tsx`

**Interfaces:**
- Consumes: the component ids only.
- Produces:
  - **SidebarWidgets.** Inside `<Show when={props.ready()}>`, after the configured widgets (and also when the list is empty, alongside the empty state), it renders `<div class="threepane-widget"><patchwork-view component={CALL_CONTROL_PANEL} /></div>`, unless some configured slot has `slotId(slot) === CALL_CONTROL_PANEL`.
  - **CSS.**
    - `.threepane-widget` keeps `flex: 1`.
    - `.threepane-widget:has(> [data-sidebar-size="fit"])` gets `flex: 0 0 auto`, and its `patchwork-view` gets `height: auto`.
    - `.threepane-widget:has(> [data-sidebar-size="none"])` gets `display: none`.
    - `[data-sidebar-size="fill"]` and an absent attribute both stay as today.

- [ ] **Step 1: Write the failing tests** (mock `@inkandswitch/patchwork-elements` as `FrameLayout.test.tsx` does).
  - With `widgets=[["chee/document-list", "automerge:r"]]` and `ready=true`, the output has exactly one `patchwork-view[component="call-control-panel"]`, and it comes last.
  - With `widgets=[]` it still has one.
  - With `widgets=["call-control-panel"]` it has exactly one, the configured one.
  - With `ready=false` it has none.
- [ ] **Step 2: Run `pnpm test SidebarWidgets` in `threepane/`.** Expected: FAIL.
- [ ] **Step 3: Implement SidebarWidgets, the CSS, the constants, the provider wrapper and `data-call-stage`.**
- [ ] **Step 4: Run `pnpm test && pnpm build` in `threepane/`, then `pnpm lint` at the root.** Expected: PASS, and `FrameLayout.test.tsx` is still green.
- [ ] **Step 5: Commit** with the message `threepane: host the call (provider, control panel, widget sizing, stage area)`.

### Task 10: threepane: the video spot

**Files:**
- Create: `threepane/src/components/CallVideoOpener.tsx`
- Modify: `threepane/src/components/DocumentAreaRoot.tsx` (render `<CallVideoOpener>` next to `<CommentsOpener>`, with `element={focusProviderElement()!}`, `selected={props.selectedContextToolId}`, `select={props.setSelectedContextToolId}`, and `open={(id) => { props.setSelectedContextToolId(id); props.setIsRightSidebarCollapsed(false); }}`)
- Test: `threepane/src/components/CallVideoOpener.test.tsx`

**Interfaces:**
- Consumes: `subscribe` from `@inkandswitch/patchwork-providers`, `useTaggedComponents("context-tool")`.
- Produces:
  - `CallVideoOpener(props: { element: HTMLElement, selected: Accessor<string | undefined>, select: (id: string) => void, open: (id: string) => void })`, which renders `null`.
  - While the tagged list contains `"call-video"`, it holds `subscribe(props.element, { type: "patchwork:call-video" }, …)`.
  - On `wanted: true` it records `previous = props.selected()`, calls `open("call-video")`, and sets `opened = true`.
  - On `wanted: false`, if `opened && props.selected() === "call-video" && previous`, it calls `select(previous)`. In every case it then sets `opened = false`.
  - If the tab goes away from the registry, the subscription is dropped.

- [ ] **Step 1: Write the failing tests.** Mock `useTaggedComponents` to return `[{ id: "call-video" }]`, and have a host element answer `patchwork:call-video` with `accept`, pushing `{ wanted }` by hand.
  - `wanted: true` calls `open("call-video")`.
  - Then `wanted: false`, with `selected()` still `"call-video"` and `previous` `"comments-view"`, calls `select("comments-view")`.
  - If the user switched to another tab before `false` came, `select` isn't called.
  - With the tag absent, there's no subscription (the host's listener isn't called).
- [ ] **Step 2: Run `pnpm test CallVideoOpener`.** Expected: FAIL.
- [ ] **Step 3: Implement the opener and wire it in.**
- [ ] **Step 4: Run `pnpm test && pnpm build` in `threepane/`.** Expected: PASS.
- [ ] **Step 5: Commit** with the message `threepane: open the call video tab when asked`.

### Task 11: In the browser, two people, one doc

Run this on astrobleme.local; browsers and test servers go there, not on the laptop.

- [ ] **Step 1: Build everything and serve it** with `pnpm build:static && pnpm dev` at the base root. Open it in two browser profiles, signed in as two different accounts.
- [ ] **Step 2: Check, and note pass or fail for each:**
  1. A has `call-doctitle-button` in its doc-title tools. On doc D, A presses it and the question opens under the button. A picks "just voice".
  2. B opens D. Within about a second (the hello), B's control panel appears at the bottom of the left sidebar, saying A is on a call, with join buttons. Before B opened D, the panel took no space.
  3. B joins with video. Each hears the other. A's button reads "hang up".
  3a. A opens another doc F. The call carries on. Clicking the call's name in A's control panel takes A back to D.
  4. With D embedded in another doc E and only E open, B still sees the call in the control panel.
  5. B sets faces to "in the sidebar". The right sidebar opens on the Call tab and shows tiles. B switches back to floating, or hangs up, and the tab goes back to what was showing before.
  6. Click a face: the stage fills the main document area. Double-click: fullscreen. Escape: back.
  7. Reload B mid-call. B is back in the call once D is on screen again.
  8. Remove the call package from the module settings and reload. threepane renders normally, with no control panel, no button and no errors that block the frame.
- [ ] **Step 3: Fix any failures in their owning task's files, with a regression test where a unit test can catch it. Then commit** with the message `call: fixes from two-browser check`.
