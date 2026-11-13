# call: a base package for calling on any doc

## Why

The call in lattice (`packages/wm/call/`, `packages/lattice/call-bar.js`) works
well, but it only exists inside lattice's window manager and only for lattice
projects. We want it in patchwork-pkg-base so anyone can start or join a call on
_any_ document, from any frame, and so lattice can later consume the same
package instead of keeping its own.

Success: open a doc in threepane, press the call button in its title bar, and
everyone else who has (or later opens) that doc on screen, and has the call
widget in their sidebar, sees the call there and can join it, without having to
know about it beforehand.

## Goals

- A new standalone base package, `call/`, containing everything:
  1. **the call provider** — a `patchwork:component` that owns the one call in
     the tab and draws everything that floats.
  2. **the call doc-title button** — a `titlebar-tool` for any doc.
  3. **the control panel** — a left-sidebar widget: asking, controls, a row of faces.
  4. **the video** — a right-sidebar context tool: the faces as big tiles,
     for when faces are "in the sidebar".
  5. **a face** — one person's live call face, to put anywhere (lattice puts
     them on cursors).
- threepane mounts the provider, and its sidebar widgets can be sized to their
  content rather than always taking an equal share.
- The call behaves as it does in lattice today: WebRTC mesh with signalling over
  the room's ephemeral channel, mic/camera/screen share, speaking detection and
  wiggle, face-centring, DeepFilterNet noise option, device choice, floating
  faces you can drag/size, the stage (click a face to fill the view, double
  click for fullscreen), rejoin after reload.

## Non-goals

- Migrating lattice now. Lattice switches to the base package _later_, once it's
  ready. Nothing in lattice changes in this work.
- Seeding the button into existing accounts. No `THREEPANE_CONFIG_VERSION` bump;
  people add `call-doctitle-button` to their doc-title tools themselves. (chee
  prefers it this way.) Whether it goes in `DEFAULT_DOCTITLE_TOOLS` for new
  accounts is left to the builder; leaning no, for symmetry.
- Isolation mode (the sandboxed-iframe document area). v1 targets threepane's
  normal mode. See "Isolation" below for how the design keeps the door open.
- Faces on cursors. Cursors are lattice's (its presence/pointer layer), and so
  is the "on cursors too" setting: it moves out of the call's settings and menu
  into lattice. The package only supplies `call-face` for lattice to put there.
- Handing out media streams. Outside tools get components (`call-face`,
  `call-video`, the provider's floating faces and stage), never `MediaStream`s.
  `patchwork:subscribe` couldn't carry them anyway: `accept`'s `respond` posts
  over a `MessagePort`, so values are structured-cloned, and a `MediaStream`
  isn't cloneable. If a tool ever needs raw streams (recording, say), a
  same-page `CustomEvent` with a `respondWith`, as `patchwork:add-to-sidebar`
  does, can hand over a live object; not for v1.
- Any notion of "the main doc". There isn't one: threepane is itself a tool in a
  `<patchwork-view>` on the account doc, and other frames (experiments'
  `space-frame`, `quiet-mode`, `patchwork-frame-tiling`, lattice's panes) show
  many docs at once. Nothing here depends on the selected-doc provider or on
  which doc is "the" one.
- Asking you to join when there's no widget. No widget, no asking (the button,
  if you have it, still shows "join"). In threepane there's always one (it
  renders it itself), so in practice this is about other frames.

## Anti-goals

- More than one call per tab. Always exactly zero or one.
- The call widget taking sidebar space when there's no call.
- Build-time coupling to any other base package (AGENTS.md: every folder is
  standalone). threepane must not import from `call/` and vice versa; they meet
  at runtime by component id, tags, events and DOM attributes.

## Constraints

- base's standalone-package rules (AGENTS.md): own `package.json`,
  `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `vitest.config.ts`, `.gitignore`; no
  `workspace:`/`link:` deps; `pnpm lint` must pass.
- The worker-parsed entry module: plugin entries are metadata-only, all code
  behind `load()`, no bare external imports in the entry's static graph.
- Today's call code imports from elsewhere in `wm`. Those are copied into the
  package (small): `lasting.js`, `kept.js`, `ui/icons.js` (only the icons used),
  `ui/along.js`, `ui/arriving.js`, `colourFor` from `pointer.js`, `faceImage`
  from `presence.js`, and `vendor/deepfilternet/`. The `HELLO` handshake with
  `presence.js` is replaced by the call package's own hello (see Protocol).
- Wire compatibility: keep the call's ephemeral message keys
  (`"lattice-wm:call"`) as they are, so that when lattice migrates, old and new
  copies in different people's browsers still hear each other.
  This is wire-format compatibility only: lattice's rooms are project folders and
  threepane's are docs, so they're only the same call when the room doc is the
  same.
- Rooms are found through the **page's repo** (`window.repo`), not a draft
  overlay's, so people on different drafts of the same doc are in the same call
  (as `wm` does with `baseRepo`). Every url that names a room (in `ask`, in a
  subscription, from a mounted doc) is normalised to the bare document url
  (`automerge:<id>`, no heads, path or fragment) before use.
- Identity comes from the globals as today (`window.accountDocHandle ??
  window.patchwork?.account`, as `add-doc-to-sidebar-button` does) and the
  contact doc. Avatars go through `automergeUrlToServiceWorkerUrl` from
  `@inkandswitch/patchwork-filesystem`, which is on the importmap, imported
  lazily as `presence.js` does.
- Settings stay in localStorage under the same key (`"lattice-wm:call"`), so
  when lattice migrates people keep their faces, devices and noise choices.
  `cursors` is dropped from them (lattice keeps its own).

## Approaches considered

- **A. Everything over events/subscriptions**, comments-style: every part,
  including the package's own UI, reads call state via `patchwork:subscribe`.
  Uniform, but the heavy UI (streams, speaking levels, stage) would re-render
  from snapshots instead of Solid signals.
- **B. One shared module**: all parts import the call module and use its
  signals directly, as `wm` does now. Least work; no way for an outside tool to
  ask for a call without knowing the package.
- **C. Shared module inside, events at the edge** — **chosen.** All the parts
  live in one package and share the call module directly (so B's coupling
  worry doesn't apply — chee pointed out it's all one package). The provider
  also answers a small DOM protocol so the doc-title button, any other tool, and
  later lattice can ask for a call or read whether one is on.

## Design

### Package layout

`base/call/` — vanilla JS + `solid-js/html` (the code is already written that
way) with a vite bundle. Entry registers five plugins:

| id                     | type                  | tags            | what                                   |
| ---------------------- | --------------------- | --------------- | -------------------------------------- |
| `call-provider`        | `patchwork:component` | —               | owns the call, draws floating things   |
| `call-doctitle-button` | `patchwork:tool`      | `titlebar-tool` | `supportedDatatypes: "*"`, `forTitleBar: true`, `unlisted: true` (same shape as `add-doc-to-sidebar-button`) |
| `call-control-panel`         | `patchwork:component` | —               | the control panel, in the left sidebar (a bare component id, so it can also go in `sidebar.widgets` as a string) |
| `call-video`           | `patchwork:component` | `context-tool`  | the video, a tab in the right sidebar |
| `call-face`            | `patchwork:component` | —               | one person's face, for anywhere (lattice's cursors) |

The call module (today's `call.js` and friends) is a shared chunk all five
`load()`s import, so they share one instance per realm. `lasting` keeps the
state on the page across dev hot-swaps as today.

### The provider

- Mounted by threepane **outermost**, wrapping both sidebars and the main area
  (alongside account/tool-storage/worker providers in `PatchworkFrame.tsx`), so
  it survives switching docs. Nothing in it is threepane-specific: any frame
  that mounts it around its docs gets calls.
- Draws a full-window layer and positions within it: the floating faces
  (today's `CallFloating`), the stage (today's `CallStage`), and the question
  you get when you press the call button (call with or without video; today's
  `CallPrompt`, opened at the `at` the button sent). threepane doesn't need an
  overlay slot; the provider places its own things. These must stack above the
  frame's own popovers and dialogs, which are in the top layer, so they use the
  popover top layer too (as `wm`'s prompt already does), not just a z-index.
- The stage fills the provider's layer (the window) by default. A frame that
  wants it to fill a particular area marks that element (builder's call; e.g. a
  `data-call-stage` attribute), and the provider uses its box instead, tracking
  it as it moves and resizes (a `ResizeObserver` plus window resize; lattice's
  panes change size). Floating faces start out near that area too, as
  `CallFloating panes=` does today.
- **What's heard: every doc on screen.** The provider listens for
  `patchwork:mounted` / `patchwork:unmounted` on its element (as
  `CommentsProvider` does), and hears calls (`hearCalls`) on each mounted doc's
  url, in the page repo, while it's mounted. Plus the room you're in, any url a
  subscriber asks about, and any **declared room** (see the protocol): a room
  that isn't a mounted doc, like lattice's project folder. `hearCalls` is already refcounted, so each source
  holds its own stop function. There's no "main doc": embeds, sidebar-pinned
  folders and the doc you're looking at are all just docs on screen.
- **No asking from the provider.** It never pops a "join?" on its own. What it
  hears is exposed to the widget (shared module) and to subscribers (protocol);
  the widget is where you're asked (below).
- Calling carries on as you move between docs, until you hang up. The session
  holds on to its room handle (as `wm`'s does), so signalling and "bye" keep
  working after the doc is unmounted. Rejoin after reload works as today, when
  the remembered room is mounted or declared again within `REJOIN_WITHIN`.
- **A room's name**, wherever one's shown (control panel, the question), is the
  name it was declared with, or else the doc's title (its datatype's
  `getTitle`).

### The protocol (for tools outside the call module's realm)

- **Asking**: a bubbling, composed `patchwork:call` CustomEvent dispatched from
  the asking element, `detail: { action, url?, at? }`:
  - `"ask"` — show the call-with-or-without-video question for `url` (`at`:
    `{x, y}` viewport point for its top left; else the provider picks a spot
    near the top of the window). This is only ever sent by something you
    pressed.
  - `"hang-up"`.
  - the builder may add `"mic"`/`"camera"` toggles if a consumer needs them.
- **Reading**: the provider answers
  `patchwork:subscribe { type: "patchwork:call", url }` with
  `{ here: boolean, others: number, elsewhere: boolean }` — whether you're in a
  call on `url`, how many others are heard on a call there, and whether you're
  in a call on some other doc. Plain data only (see non-goals on streams).
- **Declaring a room**: `patchwork:subscribe { type: "patchwork:call-room",
  url, name }`. While the subscription is held, `url` counts as on screen (it's
  heard, the control panel can ask about it, rejoin can happen) and is called
  `name`. Unsubscribing takes it away. The answer is the same as
  `patchwork:call`'s, so one subscription gives a frame both. This is what
  lattice's `inProject({room, name})` becomes, and any frame whose room isn't a
  mounted doc can use it.
- **The video spot**: `patchwork:subscribe { type: "patchwork:call-video" }`.
  Holding it says "this frame can show `call-video`". The answer is
  `{ wanted: boolean }`: true while you're in a call with faces set to the
  sidebar, false otherwise. The frame shows its video spot while it's true and
  is free to hide it when it goes false (lattice removes its inspector section,
  as it does today with `when: call.get() && call.mode() === "sidebar"`).
- **Hello**: when the provider starts hearing a room it broadcasts
  `{"lattice-wm:call": "hello"}`, and whoever's in a call there answers with
  "here" straight away, so arrival doesn't wait for the 3s heartbeat. It's a new
  value under the existing key: old copies ignore values they don't know, so
  nothing breaks. It also answers `"lattice-wm:hello?"`, for lattice's
  presence-triggered hellos.
- **Where it listens**: the provider listens for `patchwork:call`,
  `patchwork:subscribe` and `patchwork:mounted`/`unmounted` on its own element.
  threepane's title bar, sidebars and main area are all descendants of where
  it's mounted, so bubbling reaches it.

### Rooms over keys (designed for, not built)

chee wants to be able to call over an arbitrary key (for meeting people in a
string, later), with no UI for it yet. Subduction can already publish to and
subscribe on any 32-byte topic (`repo.subduction` → `publishEphemeral` /
`subscribeEphemeral` / `unsubscribeEphemeral`). But the repo owns the only
inbound ephemeral callback: it decodes each payload as a repo message and
routes it by the documentId inside (`ensureQuery(documentId)`), ignoring the
topic. So nothing in the page can hear raw messages on a key that isn't a doc
until the subduction automerge-repo fork grows a topic-listener hook.

So for now:

- A room is identified by a **room id**: a doc room is its bare automerge url,
  a key room is `key:<64 lowercase hex chars>` (the 32 bytes).
- The engine never touches a `DocHandle` directly. It talks to a **channel**
  (`{ id, on(listener), off(listener), send(message) }`), opened per room id.
  The doc channel wraps the handle's `ephemeral-message` / `broadcast`. The key
  channel isn't built yet: opening one gives nothing, so hearing a key room is a
  no-op and joining one fails with the problem "calls over a key aren't
  available yet".
- The protocol's `url` fields take any room id, so once the repo hook exists,
  only the key channel needs writing.

### The doc-title button

- Rendered against the open doc's handle. Uses the doc's url (resolved in the
  page repo, as `add-doc-to-sidebar-button` does) as the room.
- Talks to the provider **only through the protocol** (subscribe + event), not
  the shared module, so it keeps working if the title bar ends up in another
  realm (isolation).
- Shows three states: call (nobody's on), join (`others > 0`, maybe with the
  count), hang up (`here`). Pressing call/join dispatches `ask` with `at` under
  the button; pressing hang up dispatches `hang-up`.
- Without a provider (no subscription answered) it renders nothing.

### The control panel, in the left sidebar (`call-control-panel`)

- **It's where you're asked.** When a call is heard on a doc that's on screen
  and you're not in it, the widget shows it: which doc, who's on it, and join
  (with or without video; joining one while you're in another says it'll leave
  that one, as `CallPrompt` does today). More than one doc with a call on
  shows them all. Without the widget you aren't asked; that's intended.
- In a call, it's lattice's `CallBar` equivalent: where the call is, the faces
  row (drag out to float, click to stage), mic / camera / screen / hang up, and
  the menu (faces floating or in the sidebar, mic and camera device, noise; not
  "on cursors", which is lattice's). It doesn't show video tiles; that's the
  video tool's job (below).
- **Going to the call's doc.** Wherever the control panel names a room, in a
  heard call's row or as where the call you're in is, the name takes you there:
  it fires `patchwork:open-document` with the room's url (`openDocument` from
  `patchwork-elements`). The frame opens it as it opens any doc. A frame whose
  room isn't a doc it opens directly, like lattice's project folder, can
  intercept the event and go to the project instead.
- **Zero size until there's something to show.** It sets its size on its own
  element (see threepane, below): `none` when you're not in a call and none is
  heard on screen; `fit` otherwise.
- The widget can still go in anyone's `sidebar.widgets` config like any other
  (other frames, or a second spot), but in threepane it's always there (below).
- In a frame with no widget at all, mic/camera/screen/hang up need another
  home. **Builder's call, proposed:** while you're in a call, the floating "me"
  face carries those controls. Not needed for threepane.

### The video, in the right sidebar (`call-video`)

- Today's `CallTiles` (lattice puts it in its inspector, the right-hand
  sidebar): everyone's video as tiles sized to how many there are, click to
  stage. It's a `patchwork:component` tagged `context-tool`, so threepane's
  right sidebar lists it as a tab like Comments, with no threepane code for it.
- **"In the sidebar" means here.** The menu only offers faces "in the sidebar"
  while some frame holds a `patchwork:call-video` subscription (see the
  protocol), and choosing it flips that frame's answer to `wanted: true`, so it
  shows its video spot (threepane opens the right sidebar on the tab). It's the
  same idea as comments' `commentViewOpeners`/`openCommentView`, but through
  the call's own protocol rather than threepane's focus doc, so lattice's
  inspector can do it too. If faces are set to sidebar and no frame holds the
  subscription, faces show floating (the saved preference is kept).
- Out of a call it shows nothing much (a line saying there's no call). The tab
  is always listed while the package is installed, since context tools are
  registry-driven. Hiding the tab when there's no call isn't needed for v1.

### A face (`call-face`)

- One person's call face, as `Face` draws it today: their video while their
  camera's on (centred on their face), else their avatar, else their initial;
  the speaking wiggle; muted and sharing marks.
- Who: attributes on its element, `peer` (their tab's automerge peer id) and/or
  `contact` (their contact url), matched as `call.find(person)` does today (by
  peer, else by contact). Renders nothing when that person isn't in your call,
  so a frame can put one on everyone and only the ones in your call show.
- Size: a plain CSS size (attribute or `--call-face-size`), not lattice's
  `--lattice-px`; lattice scales it as it scales the rest of its ui. A way to
  leave out its title (lattice's cursors already show the name).

### What lattice will use

Not built now, but the parts above are meant to cover all of it. Outside
`wm/call/`, lattice touches the call in five places:

| lattice today | becomes |
| --- | --- |
| `CallBar` at the bottom of the projects (`lattice/call-bar.js`) | `call-control-panel` |
| `CallTiles` in the inspector (`lattice/frame.js`) | `call-video`, shown while its `patchwork:call-video` answer is `wanted` |
| `CallFloating` / `CallStage` over the panes (`wm/workspace.js`) | the provider, with lattice's panes marked as the stage area |
| the project as the room, and the phone beside + (`inProject`, `hearCalls`, `onCallIn`, `CallPrompt near=phone`) | a `patchwork:call-room` declaration with the project's name; the phone is `call-doctitle-button` rendered against the folder, or lattice's own button using `patchwork:call` |
| faces on cursors (`call.cursors()`, `call.find`, `Face`) | lattice's own "on cursors" setting, and a `call-face` with `peer`/`contact` on each cursor |

### threepane changes

1. **Mount the provider** as above. A missing `call` package must degrade to
   nothing (the `patchwork-view component=` lookup just doesn't render), and
   threepane must not wait on it being ready.
2. **Render the call widget itself**, by name: a
   `<patchwork-view component="call-control-panel">` that threepane puts in a fixed
   spot, not in the configured `sidebar.widgets` and not through any package
   dependency. It's just a late-bound component id, so without the call package
   it renders nothing. Spot (my call): the bottom of the left sidebar's widget
   stack, above the tray, as lattice's call bar sits at the bottom of its
   projects. It sizes itself with `data-sidebar-size` like any widget, so it
   takes no space until there's a call to show. If someone has also configured
   `call-control-panel` as a widget, threepane skips its own so it doesn't show
   twice. The left sidebar collapsing unmounts it; the call lives in the
   provider and carries on.
3. **Sidebar widget sizing.** Today every `.threepane-widget` is `flex: 1`. A
   widget declares how much it wants by setting `data-sidebar-size` on its own
   element (the `patchwork-view` it's rendered into), at runtime, changeable:
   - absent / `fill` — as now: flexes to share the remaining space (root folder).
   - `fit` — as tall as its content (`flex: 0 0 auto`, view `height: auto`),
     e.g. the call, a recents list. The widget is responsible for capping its
     own height and scrolling internally if it can grow large.
   - `none` — takes no space at all, including no gap (wrapper `display: none`
     or equivalent).
   threepane's CSS reads it with `.threepane-widget:has(> [data-sidebar-size=…])`.
   If every widget is `fit`/`none`, the stack sits at the top.
4. **The video spot.** While the right sidebar has a `call-video` tab, threepane
   holds a `patchwork:call-video` subscription (from inside the provider, so it
   bubbles there). On `wanted: true` it opens the right sidebar on that tab. On
   `wanted: false`, if it was threepane that switched to the tab and it's still
   showing, it goes back to the tab that was showing before (my call); the tab
   itself stays listed.

### Isolation

Not supported in v1. The button only uses the event/subscribe protocol, so if
isolation relays `patchwork:subscribe` and events out of the iframe (the worker
provider already relays its subscriptions), it can work there later. Media
capture in the sandboxed iframe isn't needed: the provider and widget live in
the host frame.

### Testing

Carry over `wm`'s pure-function tests (`call-sizes`, `call-wiggle`, `kept`) to
vitest. Add tests for the protocol's answers (`patchwork:call`,
`patchwork:call-room`, `patchwork:call-video`), `call-face`'s peer/contact
matching, and for the widget-size
CSS selection in threepane. Multi-peer behaviour is checked by hand (two
browsers, one doc).

## Left to the builder

- How a frame marks the stage's area, and whether threepane marks its main area.
- Where the button's question sits when no `at` is given.
- Whether the button shows a count.
- Exact icons, copy and CSS (following base's CUBE/theming rules; derive from
  `--editor-*`/`--studio-*` in `@layer package`).
- Whether to add the button to `DEFAULT_DOCTITLE_TOOLS` for new accounts.
- The controls' home in frames with no call widget (proposal above).
