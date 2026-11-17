# Call faces in the canvas

People in a call, looking at a tldraw5 canvas, can have their faces live in the
canvas: at absolute canvas positions, panning and zooming with everything else.
Anyone in the call can arrange anyone's face (move, resize, take it off).

## The layout doc

The arrangement belongs to the call, not the tldraw doc, so it lives in an
ad-hoc automerge doc made for the call: the **layout doc**, made in the page
repo (`pageRepo()`).

```
{ spots: { ["<room>|<person>"]: { x, y, size } } }
```

- `room` is the bare doc url the faces are on (one call can be on several
  docs). `person` is the person's contact url, or their call id if they have
  no contact, so a face belongs to a person across tabs and reloads.
- **Flat keys, not `spots[room][person]`.** Two people creating
  `spots[room] = {}` at once is an automerge conflict where one map (and
  everything written into it) is dropped. With one key per face, concurrent
  writers only ever conflict on the same face, where last-writer-wins is right.
  The doc is created with `spots: {}` so nobody creates `spots` itself.
- `x, y` are the top-left of the face in the canvas's own coordinates, `size`
  its diameter in canvas units.
- Leftovers cost nothing: a spot for someone who isn't in the call is not drawn.

## Negotiating which doc

Over the room's broadcast channel, in the "here" message the call already sends
every few seconds, plus on offers (`about()` in `engine/call.js`): a new
optional field `layout: "<automerge url>"`.

- Nobody makes one until something needs one (a tool asks to place a face).
- Whoever needs one first creates it, remembers it, and says "here" at once.
- Anyone hearing a url that sorts lower than the one it has (or has none) adopts
  it: it finds the doc, merges what it had in its own doc into it (entries the
  new doc doesn't have yet; the adopted doc wins a conflict), then switches and
  says "here" again. Anything sorting higher is ignored.
- Late joiners have no layout, so they adopt whichever they hear. Every "here"
  heard before the join is replayed on join (`onCallIn`), so this is immediate.
- **Races.** Two made at once, A < B: B's holder hears A, merges B into A and
  switches; A's holder ignores B. A third person who heard B first adopts B,
  then hears A and moves again, merging B's entries on. "Lowest wins" only
  moves one way, so it converges and nothing written is dropped (it is copied
  forward by whoever moves). If a lower url is still being fetched when a
  higher one is, whichever finishes: the higher is only ever adopted if nothing
  lower is held.
- **Someone leaving.** Nothing to do: everyone still in the call carries on
  announcing the url they hold. If everyone who held it leaves, it stops being
  announced and the next person who needs one makes a new one (the old doc
  still exists, and is simply not used). Hanging up closes our handle.
- A placement made while a lower url is still being fetched waits for the
  fetch, so it lands in the doc that wins.
- A peer on an older version ignores the field and sends none. That is fine:
  they don't see canvas faces (their floating faces behave as before), and
  everyone else's agreement is unaffected. Their spots can still be arranged by
  others.

## Protocol (`src/protocol.js`)

| name                    | kind              | |
| ----------------------- | ----------------- | - |
| `patchwork:call-faces`  | subscription `{url}` | held while a tool is showing faces on the doc `url`. Answers `{here, people, spots}`. |
| `patchwork:call` event  | `{action: "place-faces", url, spots: {[person]: {x, y, size}}}` | writes to the layout doc (making it if needed) |
| `patchwork:call` event  | `{action: "unplace-face", url, person}` | takes a face off the canvas |

Answer: `here` is whether you are in a call at all; `people` is everyone in it,
you first: `[{key, id, name, colour, me}]` (`key` the person key; `id` the
call's own id, which `call-face` takes as `person`); `spots` is the layout for
`url` only, by person key. Answered now and whenever it changes, like the
other subscriptions (`answer()` in `provider.js`).

`call-face` gains `person="<call id>"` (or `person="me"`), so it can show you,
and people without a contact. Its `peer` / `contact` attributes still work.

## Floating faces step aside

Holding `patchwork:call-faces` for a doc records that doc as "shown". While it is
held, anyone with a spot in a shown doc is not drawn floating
(`call.onCanvas(id)`, checked in `CallFloating`). Anyone without a spot keeps
floating. Letting go (the tool unmounts, or the provider goes) puts them back,
and so does taking the face off the canvas. Screens being shared are not
faces and keep floating.

## tldraw5

A React layer in `InFrontOfTheCanvas` (`src/CallFaces.tsx`), absolutely
positioned with `pointer-events: none` so drawing tools aren't blocked except
where a face actually is. Subscribes with `useSubscribe` to
`patchwork:call-faces`. Page to screen via `editor.pageToViewport` and the zoom.

- Each placed person in the call is a `<patchwork-view component="call-face">`
  in a wrapper: drag the face to move, drag its bottom-right corner to resize,
  a small "off the canvas" button (on hover or focus) to take it back to
  floating. Writes go out as events while dragging (one per animation frame),
  so everyone sees it move.
- A single pill at the top centre ("Put faces on the canvas") appears while you
  are in a call and anyone isn't placed; it puts everyone not placed in a row
  near the middle of the view.
- No motion beyond `cubic-bezier(0.23, 1, 0.32, 1)` on button hover, off
  under `prefers-reduced-motion`.

## No call package

No provider answers the subscription, so `useSubscribe` keeps its initial
value (`here: false`) and the layer renders nothing. tldraw5 imports nothing
from `call`.
