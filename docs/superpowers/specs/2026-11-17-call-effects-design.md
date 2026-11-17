# call effects

Video effects for the `call` package that other packages can contribute as
plugins. Someone in a call turns one on, and everyone else sees it on their
video. Cat ears (`call-cat-ears/`) are the first.

## what it has to do

- an effect is a plugin, from any package. `call` finds them at runtime and
  never depends on one at build time (CLAUDE.md).
- the effect is drawn by the sender, into the video that goes out, so every
  peer sees it with nothing for them to install or support. your own preview
  is that same track, so it shows too, mirrored as it is now.
- off is the default. the choice is remembered in the call's settings.
- it can fail (no model, a throwing effect, an old browser) and the call goes
  on with the plain camera.

## the plugin

type `patchwork:call-effect`, registered like any other plugin:

```js
{
  type: "patchwork:call-effect",
  id: "cat-ears",
  name: "Cat ears",
  icon: "Cat",                      // as other plugins' icons
  kind: "overlay",                  // "overlay" | "background" | "filter": how it's grouped
  needs: ["landmarks"],             // what it wants in `frame`: "landmarks", later "mask"
  effect: "./effect.js",            // the module that draws, relative to this package's entry
  load: () => import("./effect.js") // for the same module on the main thread (tests, tools)
}
```

`effect.js` exports `draw(ctx, frame)`:

- `ctx`: a 2d context of an OffscreenCanvas, with the camera's picture already
  drawn on it, unmirrored. draw over it, or redraw it (a filter or a
  background).
- `frame`: `{landmarks, mask, time, width, height}`. `landmarks` is the one
  face's 478 points from MediaPipe's face landmarker, each `{x, y, z}` with x
  and y as fractions of the picture, or `null` when no face is found (or none
  has been yet). `mask` is `null` until a segmentation model's added.
  `time` is in milliseconds, for animation. `width` and `height` are the
  picture's pixels.
- it's called for every frame. it should be quick, hold no state that matters
  and draw nothing when it has no face.
- it can also export `dispose()`, called when it's switched off.

`needs` is on the description, not in the module, because the engine has to
know it before it loads anything: an effect that needs nothing never causes
the model to be downloaded.

## how effect code gets into the worker

Frames are processed in a worker, so `draw` has to run there. The worker can't
see the registry or the plugins' `load()`s. Two things make it work:

1. the plugin's `importUrl` (set by `registerPlugins`) is the url of its
   package's entry, as the page loaded it (in patchwork, a service-worker url
   for that package's doc). `effect` is resolved against it:
   `new URL(plugin.effect, plugin.importUrl)`. the main thread does that and
   tells the worker the absolute url.
2. the worker `import()`s that url. dynamic import works in a classic worker,
   and the url is same-origin and answered by the same service worker as the
   page's modules.

So the effect module must be **self-contained**: a worker has no import map,
so it can't have bare imports (`solid-js`, `@inkandswitch/...`), and it must
not be in a chunk shared with the package's plugin list. In practice it's
plain canvas code with no imports, which is the house style. The cat ears
package builds `effect.js` as its own entry, to check this.

The worker is a classic worker, not a module worker, because MediaPipe's
tasks-vision loads its wasm with `importScripts`, which module workers
refuse (checked: a module worker fails with "Module scripts don't support
importScripts()", a classic worker's fine).

If a contributed effect's url can't be imported or has no `draw`, the worker
says so and the call falls back (see failure).

## the pipeline

```
camera track ──► MediaStreamTrackProcessor ──readable──► worker
                                                           │ per frame: VideoFrame → OffscreenCanvas,
                                                           │ landmarks (if the effect needs them), draw()
 senders ◄── processed track ◄── MediaStreamTrackGenerator ◄┘ new VideoFrame
```

The processor and generator are made on the main thread, and only their
`readable` and `writable` streams are transferred to the worker. That works in
every Chrome that has them; transferring the tracks is newer.

- **call.js** takes the camera as it does now (`getTrack("video")`), then, if
  an effect's chosen and supported, wraps it (`effects.processed`): the track it
  returns goes into `useTrack` like the camera's did, so `replaceTrack`, the
  preview and everything else work unchanged and nothing is renegotiated. its
  `stop()` also stops the camera track and the worker, as `noise.suppressed`
  does for the mic.
- face centring (`face.js`) keeps watching the **raw** camera track (the
  processed track carries a `source` property for that), so ears aren't
  detected as part of the face.
- choosing another effect while one's running sends the worker a message: no
  new track. turning effects on or off changes whether the processed track is
  there at all, so the camera is taken again (as `refreshMic` does) and swapped
  in with `replaceTrack`.
- with no effect, nothing here runs: no worker, no model, the raw camera
  track goes out exactly as before.

## landmarks

MediaPipe Face Landmarker (tasks-vision, `face_landmarker.task`, float16,
3.7MB), run in the worker, one face. It's loaded only when an effect that
`needs` landmarks is on, following `noise.js`:

- the model is downloaded by the main thread, with progress (shown in the
  menu and under the call, like DeepFilterNet), checked against its sha-256,
  kept in indexeddb, and handed to the worker as bytes
  (`modelAssetBuffer`), so it's downloaded once and never twice.
- tasks-vision's script and wasm (pinned, from jsdelivr, as `face.js` already
  does) are fetched by the worker, and cached by the browser as it caches
  anything. their progress isn't shown.
- detection runs at most 20 times a second, whatever the video's frame rate
  is, and its result is eased (a jittery find comes out steady) and reused for
  the frames between. on a frame where it's still being loaded, the picture
  goes out undrawn on.

`mask` is for later: the selfie segmenter would be loaded the same way when an
effect `needs: ["mask"]`, and the worker already gives `frame.mask` as `null`.
Nothing about the contract changes then.

## browser support

Needs `MediaStreamTrackProcessor`, `MediaStreamTrackGenerator` and
`OffscreenCanvas` (Chrome and Edge). In Firefox and Safari there's no such
processor, and **effects aren't offered**: no menu entry, a saved choice is
treated as off.

The fallback would be a canvas on the main thread with `captureStream()`. It
isn't worth it: it only runs while the tab is visible (`requestAnimationFrame`
stops in a background tab, which is where a call spends its time, so your
video would freeze for everyone else), it competes with the page for the main
thread, and it'd be a second pipeline to keep working for a feature that's
nice rather than needed. Effects are drawn by the sender, so a Firefox or
Safari user still *sees* everyone else's effects fine.

## cpu

A call already runs DeepFilterNet (an AudioWorklet, its own thread) and the
page. Effects add the worker's thread only:

- frames are processed in the worker, so the page's main thread does nothing
  per frame.
- detection is capped (20/s) and the draw is a few canvas paths.
- the transform stream has back pressure: if the worker can't keep up it
  drops frames (every `VideoFrame` is closed), and the video's frame rate
  falls rather than a queue growing.
- it's only on when someone chose it. no effect, no cost.
- if frames take longer than they're arriving for a few seconds, the worker
  says so and the call drops the effect (like DeepFilterNet's `onOverload`),
  with a line saying so.

## failure

Every failure ends with the raw camera going out and a line in the call's
`problem` (and the saved choice set to off for the failures that would repeat):

- the model can't be downloaded or fails its hash: that effect's drawn without
  landmarks (so, ears draw nothing) until it can be; the menu line says
  "couldn't download it" like DeepFilterNet's.
- the worker or the effect module can't start (a bad url, no `draw`, an import
  of something that isn't there): the effect's dropped, camera back.
- `draw` throws: it's tried again on the next frame; ten in a row and it's
  dropped as above. one bad frame is never a frozen video.
- the plugin disappears from the registry (package unloaded): it's chosen but
  not found, so the same: no effect.
- the worker's stream ends or errors: the camera's taken back.

## what's tested

Pure parts with vitest: placing ears from landmarks (`call-cat-ears`),
easing landmarks, the registry lookup and url resolving, settings, and the
off path (the raw camera track is what's in the senders). The pipeline is
tested with a fake worker and fake processor/generator. The worker, MediaPipe
and the drawing were checked in real Chrome on another machine, with a still
of a face.
