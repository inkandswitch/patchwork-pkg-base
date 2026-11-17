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
  cursors, or cameras pinned to places on a canvas.

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
| `call-face`            | component                           | One person's face, to put anywhere (you too). Shows nothing if not in your call.                |
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

### 6. Optional: name a room that isn't a doc on screen

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

Each `patchwork:call` subscription makes the call listen in on that doc's
room. That's fine for the doc you're showing, but not for a list of hundreds.
To mark which of many docs the call is in (a doc list, a search result), ask
once, with `patchwork:call-now`, and compare:

```js
const off = subscribe(element, { type: "patchwork:call-now" }, ({ room }) => {
  // room: the bare url of the doc your call's in, or null
  // (compare it with each url with its #heads and /path cut off)
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
- `person`: their id in the call (from `patchwork:call-faces`' `people`), or
  `"me"` for yourself. A `contact` that is your own also shows you.
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
people in a call to arrange their faces *in the canvas*, so they pan and zoom
with everything else, and so that **anyone in the call can arrange anyone's
face**. The call owns the arrangement (it's shared by everyone in the call and
isn't written into your doc), and you own where on screen it's drawn. tldraw5
does this (`tldraw5/src/CallFaces.tsx`); copy it.

1. **Subscribe, and keep holding it while you show faces.**

   ```js
   const off = subscribe(element, { type: "patchwork:call-faces", url: handle.url }, ({ here, people, spots }) => {
     // here: you're in a call
     // people: everyone in it, you first: [{key, id, name, colour, me}]
     // spots: where they've been put on *this* doc: {[key]: {x, y, size}}
     //        in your own coordinates; x, y the top left, size the diameter
   });
   ```

   While you hold it, anyone with a spot on this doc stops floating (they'd
   appear twice otherwise). Anyone without one keeps floating. Let go (`off()`)
   and they float again. With no call, or no call package, you hear `here:
   false` or nothing at all: render nothing.

2. **Draw a `call-face` at each spot.** Use `person` (the `id` from `people`,
   which also works for you: `"me"`):

   ```js
   const face = document.createElement("patchwork-view");
   face.setAttribute("component", "call-face");
   face.setAttribute("person", person.id); // or "me"
   face.setAttribute("size", String(Math.round(spot.size * zoom)));
   face.style.transform = `translate(${screenX}px, ${screenY}px)`;
   ```

3. **Let people arrange them.** To place, move, resize or take faces off, say so:

   ```js
   // `key`s are people's `key`s. null takes a face off the canvas
   element.dispatchEvent(new CustomEvent("patchwork:call", {
     bubbles: true,
     composed: true,
     detail: { action: "place-faces", url: handle.url, spots: { [key]: { x, y, size }, [otherKey]: null } },
   }));
   ```

   The change comes back through the subscription for everyone in the call.
   Send it as often as you like while dragging; show your own pointer position
   meanwhile and let go of it when the answer catches up.

**How the layout is shared.** The first time anything places a face, the call
makes an automerge doc for itself (the *layout doc*) in the page's repo, and
adds its url to the "here" message that it already sends over the room's
channel every few seconds. Anyone who hears a url that sorts lower than the one
they hold switches to it (copying across what they had written). Two made at
once therefore end up as one; late joiners take the one they hear; when the
call ends it simply stops being announced. Its shape is
`{spots: {"<doc url>|<person>": {x, y, size}}}`, per doc because one call can be
on several docs, and by person (their contact url, or their call id with no
contact) so a face belongs to a person across tabs and reloads. See
`docs/superpowers/specs/2026-11-17-call-canvas-faces-design.md`.

Peers on an older version of the call don't announce a layout and ignore
others'. They're not stopped from being in the call; they just keep floating
faces and don't see the canvas ones.

**Not there yet.**

- Layout docs aren't cleaned up. A call's is abandoned when it ends.
- Placing faces from a call that's in another doc's room works, but a
  `key:` room has no channel yet, so no layout can be agreed over one.
- Everyone in the call can arrange everyone's face; there's no "only mine".

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
  (`channel.js`), WebRTC, noise suppression. `call.js` has the full
  story at the top of the file.
- `src/ui/` holds the Solid views (`solid-js/html`, no JSX), and `styles.css`.

It shares its wire format with lattice's call (`lattice-wm:call`), so a
Patchwork call and a lattice call in the same doc can hear each other.
