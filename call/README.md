# call

Video and voice calls on any doc. Everyone who has a doc open can call
everyone else who has it open. A call keeps going as you move from doc to doc,
until you hang up. Only one call runs in a tab at a time.

The doc is the room: whoever has it open is in the room. The call connects
people over WebRTC, and the doc's ephemeral messages carry what's needed to set
up those connections. Nothing about a call is written into any doc.

This README is for two kinds of people (or their agents):

- **[frame authors](#adding-calls-to-your-frame)**: you've made a frame (the
  thing that holds the title bar, sidebars and main view, like `threepane`)
  and you want it to have calls.
- **[tool authors](#making-your-tool-call-aware)**: you've made a tool (a
  canvas, an editor) and you want calls to fit it well. For example, faces on
  cursors, cameras pinned to places on a canvas, or following someone's
  viewport.

Neither kind of code takes a build-time dependency on this package. Everything
is looked up at runtime: by component id, by the `patchwork:call*`
subscriptions and events, and by a few `data-call-*` attributes. If the call
package isn't installed, every one of these finds nothing and quietly does
nothing. Keep it that way. Don't import from `call/src`.

## What's in the package

| id                     | kind                                | what it is                                                                                             |
| ---------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `call-provider`        | component                           | The call itself. It goes around your frame, answers the protocol, and draws everything that floats.    |
| `call-control-panel`   | component                           | For a sidebar: calls you could join, the call you're in, mic, camera, screen, hang up, settings.       |
| `call-video`           | component, tagged `context-tool`    | Everyone's video as tiles, as a sidebar tab. Faces go here when someone picks "in the sidebar".        |
| `call-face`            | component                           | One person's face, to put anywhere. Shows nothing if that person isn't in your call.                   |
| `call-doctitle-button` | tool, tagged `titlebar-tool`        | The phone button in a doc's title bar: call, join (with a count of who's in), or hang up.               |

The protocol is described in [`src/protocol.js`](src/protocol.js), and its
names are in [`src/protocol-names.js`](src/protocol-names.js).

---

## Adding calls to your frame

`threepane` is the reference frame. Each step below points at the place in
threepane that does it.

### 1. Put the provider around everything

```html
<patchwork-view component="call-provider">
  <!-- your whole frame: title bar, sidebars, main view -->
</patchwork-view>
```

The provider learns which docs are on screen from the `patchwork:mounted` and
`patchwork:unmounted` events of every `<patchwork-view doc-url>` inside it. It
listens in on each of those rooms, so it knows when someone there is in a call.
It also answers subscriptions from anything inside it. That's why it has to
wrap **everything**, including the title bar and both sidebars. If it only
wraps the main view, the title-bar button and the control panel can't reach it.

Put it **above** whatever remounts when the user switches docs. The call
belongs to the tab, not to a doc. If the provider is unmounted, the call is
torn down with it.

Don't wait for it to load. It's late-bound, so render your frame straight away.
When the provider arrives, it picks up every view that is already mounted.

> threepane: `src/PatchworkFrame.tsx`, the `<patchwork-view component={CALL_PROVIDER}>`.

### 2. Mark where the stage goes

```html
<div class="main-area" data-call-stage>…</div>
```

When someone "puts a face on the stage" (it fills the main area) or shares a
screen, the provider draws it over the first element with `data-call-stage`
that it finds under itself. It tracks that element as it moves and resizes.
Without one, the stage fills the window.

> threepane: `src/components/DocumentAreaRoot.tsx`, `.main-area`.

### 3. Give the control panel a home

```html
<patchwork-view component="call-control-panel" data-sidebar-size="none"></patchwork-view>
```

A sidebar is the usual place for it. The panel sets `data-sidebar-size` on its
own element: `fit` while there is something to show (you're in a call, or
there's a call on screen you could join), and `none` when there isn't. Read
that attribute in your CSS so the panel takes up no space when it's empty:

```css
[data-sidebar-size="none"] { display: none; }
```

Start it at `none` yourself, so nothing flashes while the panel loads (and so
nothing shows at all if the package isn't installed).

> threepane: `src/components/SidebarWidgets.tsx`. The panel always goes last
> in the left sidebar.

### 4. Title-bar tools: nothing to do (probably)

`call-doctitle-button` is an ordinary `titlebar-tool` that supports `"*"`. If
your frame already renders `titlebar-tool`s for the open doc, the button turns
up on its own. It reads the doc's url from the nearest
`<patchwork-view doc-url>` above it, so render it inside the doc's view (or
inside something that carries the doc's `doc-url`).

The button finds out about the call by subscribing to the provider. If it can't
find a provider, it renders nothing.

### 5. Optional: a place for the video

When your frame has a tabbed sidebar that can show `context-tool`s, the
`call-video` tab can live there. To offer "faces in the sidebar" as a choice in
the panel's menu, tell the provider you have a spot for it, and open the tab
when the provider asks for it:

```js
import { subscribe } from "@inkandswitch/patchwork-providers";

// `anchor`: any element inside the provider
function listen(showing) {
  return subscribe(anchor, { type: "patchwork:call-video", showing }, ({ wanted }) => {
    if (wanted) openSidebarTab("call-video");
    else restorePreviousTab();
  });
}
```

- Subscribing at all says "this frame can show the video". While nothing has
  subscribed, "in the sidebar" isn't offered as a choice.
- `showing` says whether the tab is on screen **right now**. Subscribe again
  whenever that changes. While it's `false`, faces float even when the user has
  picked "in the sidebar", so they never disappear.
- `wanted` comes back `true` while you're in a call with faces in the sidebar.

> threepane: `src/components/CallVideoOpener.tsx` does exactly this, including
> putting back whatever tab was open before.

### 6. Optional: let people follow each other

```html
<div data-call-follow="main">
  <patchwork-view doc-url="…" tool-id="…"></patchwork-view>
</div>
```

Mark an area with `data-call-follow="<name>"` and people in a call can follow
each other there. Whatever the person you're following has open in their
`"main"` opens in yours too. If the tool supports it, how they're looking at it
follows as well: their scroll position, their canvas camera (see
[being followed](#being-followed-share-your-view-state)). A line in their
colour goes around the area while you follow. Pressing it, or opening something
else there yourself, stops following.

Only the `patchwork-view` at the top of each marked area is shared. Nothing
outside a marked area is ever shared. Use the same name for the same kind of
place across frames (`"main"` for the main view), so that people using
different frames can still follow each other.

### 7. Optional: name a room that isn't a doc on screen

The provider names rooms after the docs that are mounted in it. If your frame
has a sense of "where you are" that isn't a mounted doc (a project, a folder
you're browsing), you can hold that room and give it a name for as long as
you're there:

```js
const off = subscribe(anchor, { type: "patchwork:call-room", url, name: "my project" }, ({ here, others, elsewhere }) => {
  // here: you're in this room's call
  // others: how many other people are in it
  // elsewhere: you're in a call in some other room
});
```

A `url` is any doc url (heads and paths are stripped, so every version of a
doc is the same room).

### Things to get right

- **The provider can load after you subscribe.** Anything that subscribes
  should subscribe again when the provider mounts. Watch for that event:

  ```js
  addEventListener("patchwork:mounted", (event) => {
    if (event.detail?.componentId === "call-provider") resubscribe();
  });
  ```

  Both `button.js` and threepane's `CallVideoOpener` do this.
- **The call floats over your frame.** The question, the faces and the stage
  are popovers in the top layer, so you don't need to make room for them.
- **Theming.** The call's colours are `--call-*` custom properties
  (`src/ui/styles.css`). They're taken from the `--studio-*` theme variables,
  inside `@layer package`. Set the `--studio-*` variables and the call matches
  your frame. To restyle the call on its own, set `--call-*` directly.

---

## Making your tool call-aware

You get a lot without doing anything. Any doc your tool shows can be called
from its title bar, and faces float over everything. The rest of this section
is for when you want calls to feel like part of your tool.

### Start, join or hang up from inside your tool

```js
const send = (detail) =>
  element.dispatchEvent(new CustomEvent("patchwork:call", { bubbles: true, composed: true, detail }));

send({ action: "ask", url: handle.url, at: { x, y } }); // asks "call everyone here?" next to (x, y), in viewport px
send({ action: "hang-up" });
```

`ask` doesn't start a call straight away. It puts the call's question by the
point you give it (say, under the button that was pressed), and from there the
person can choose video or just voice.

To know what's going on in a call, subscribe to it:

```js
const off = subscribe(element, { type: "patchwork:call", url: handle.url }, ({ here, others, elsewhere }) => {
  // here: you're in this doc's call · others: how many others are · elsewhere: you're in one in another doc
});
```

As in the frame section above, subscribe again if the provider mounts later.
With no provider, you never hear back. Treat that as "there are no calls here"
and show nothing.

### Faces anywhere: `call-face`

```html
<patchwork-view component="call-face" peer="<their peerId>" contact="<their contact url>" size="32" no-title></patchwork-view>
```

This shows one person's live face (their camera, or else their avatar or
initial), with a ring that lights up while they speak and a badge while they're
muted. The attributes are live, so you can change them and the face follows.

- `peer`: the `peerId` of their tab, as your doc's presence knows it
  (automerge-repo's `Presence` gives you `peer.peerId` for each peer).
- `contact`: their contact doc's url (who they are, across tabs). If no one in
  the call matches the `peer`, the face is looked up by `contact` instead. Give
  both if you can.
- `size`: in px.
- `no-title`: leave their name off the face (when you already show it, for
  example on a cursor).

**If that person isn't in your call, it renders nothing.** So you don't need to
know who's in the call. Put a `call-face` next to everyone you already know
about from presence (every cursor, every avatar in a list), and the faces show
up for exactly the people in the call. They appear when someone joins and go
away when they leave.

A face on each cursor (lattice does this) looks something like:

```js
function faceOn(cursor, peer) {
  let face = cursor.querySelector("patchwork-view[component=call-face]");
  if (!face) {
    face = document.createElement("patchwork-view");
    face.setAttribute("component", "call-face");
    face.setAttribute("size", "28");
    face.setAttribute("no-title", "");
    cursor.append(face);
  }
  face.setAttribute("peer", peer.peerId);
  if (peer.value?.contact) face.setAttribute("contact", peer.value.contact);
}
```

tldraw5 already has both ids to hand: its presence records are keyed by
`peerId`, and its `userId` is `${contactUrl}-${peerId}`.

### Cameras that live in your canvas

Suppose your tool is a canvas (a tldraw, a whiteboard, a map) and you want the
people in a call to choose where their camera sits, *in the canvas*, so that
it pans and zooms along with everything else. Treat it as two separate
problems: where each person's camera is (your data, in your doc), and what each
camera shows (`call-face`).

1. **Store the placements in your doc.** Key them by contact, so a camera
   belongs to a person and not to a tab. It's still there after they reload,
   and if they rejoin from their phone it comes back in the same place:

   ```js
   /** @typedef {{x: number, y: number, size: number}} CameraSpot  canvas coordinates */
   /** doc.callCameras: {[contactUrl]: CameraSpot} */
   handle.change((doc) => {
     doc.callCameras ??= {};
     doc.callCameras[myContactUrl] = { x, y, size: 160 };
   });
   ```

   Because they're in the doc, everyone sees the same layout, it syncs and
   merges like the rest of your data, and undo works on it. If you'd rather the
   layout belonged to the call and not the doc, broadcast it over presence
   instead. It's gone when everyone leaves.

2. **Draw a `call-face` at each spot, in canvas space.** Put it in whatever
   layer moves with the camera (a tldraw custom shape, or an absolutely
   positioned overlay that you transform with the viewport):

   ```js
   for (const [contact, spot] of Object.entries(doc.callCameras ?? {})) {
     const face = faceFor(contact); // one <patchwork-view component="call-face"> per contact, kept
     face.setAttribute("contact", contact);
     face.setAttribute("size", String(Math.round(spot.size * zoom)));
     face.style.transform = `translate(${spot.x}px, ${spot.y}px)`;
   }
   ```

   The face renders nothing for anyone who isn't in your call. So a placement
   that's left over from last week costs nothing and shows nothing until that
   person joins again. You don't have to clean placements up.

3. **Let people place themselves.** For example, have a "pin my camera here"
   action, or make someone's face draggable once they're in the call. To know
   whether *you're* in the call, use the `patchwork:call` subscription.

The rule underneath all of this: **your tool owns the layout and the call owns
the media.** Keep your data about where people's cameras are. Don't try to get
at their streams.

**Not there yet.** These are the rough edges for in-canvas cameras today. If
you need one of them, it belongs in the protocol, so open an issue rather than
working around it:

- `call-face` can't show **you**. It only finds other people in the call. Your
  own face is still in the floating faces, the panel and the video tab.
- The floating faces don't know your tool is already showing them, so for now
  people appear twice. A natural fix would be a subscription like
  `patchwork:call-video`, where a tool says "I'm showing faces for this room"
  and the floating ones step aside while it does.
- There's no list of who's in the call through the protocol, only a count
  (`others`). Use presence to know who's around, and `call-face` to show the
  ones who are in the call.

### Being followed: share your view state

When your tool is inside an area the frame marks with `data-call-follow`, it
can share how it's being looked at (scroll position, camera, zoom, the
selected page), so people following see what the person they follow sees.

```js
import { subscribe } from "@inkandswitch/patchwork-providers";

subscribe(element, { type: "patchwork:view-state" }, async (url) => {
  const view = await repo.find(url); // the repo your tool was given
  // write yours as it changes:
  editor.on("camera", (cam) => view.change((doc) => Object.assign(doc, { x: cam.x, y: cam.y, z: cam.z })));
  // and take it when it changes:
  view.on("change", ({ doc }) => editor.setCamera(doc));
});
```

You get back the url of a doc in the realm's scratch repo, which is never
saved or synced. Write your view state into it, and keep it small (a few KB of
plain JSON, and nothing over 32 KB). **Always find it with the repo you were
given**, not the page's own repo. While someone else is following you, nothing
changes for you. While *you* follow someone, that same url quietly resolves to
a copy of their view state that keeps updating, so all you have to do is
listen for `change` and apply what you get. When you stop following, your own
view state is left wherever theirs had got to.

Make applying a view state idempotent: apply it without writing it back if it's
already what you have. Otherwise your write and their update keep bouncing off
each other.

Outside a marked area, or with no call package, nothing answers the
subscription and nothing happens.

---

## Working on this package

```sh
pnpm install
pnpm build     # vite, to dist/
pnpm test      # vitest, with happy-dom
pnpm sync      # build, then pushwork sync
```

- `src/index.js` is the plugin list. It's read in a worker, so it only lists
  each plugin, and the real code is loaded behind `load()`.
- `src/provider.js` and `src/protocol.js` are the boundary everything else
  talks through.
- `src/engine/` is the call: rooms, signalling over ephemeral messages
  (`channel.js`), WebRTC, following, noise suppression. `call.js` has the full
  story at the top of the file.
- `src/ui/` holds the Solid views (`solid-js/html`, no JSX), and `styles.css`.

It shares its wire format with lattice's call (`lattice-wm:call`), so a
Patchwork call and a lattice call in the same doc can hear each other.
