// The "llm:skill" plugin for Patchwork's chat computer: instructions for
// creating and editing tldraw canvases with the chat's generic document tools
// (read_doc / automerge_op / replace_text). Auto-activates when the focused
// document is a tldraw5 canvas (see the registration in index.ts).
//
// It also contributes ONE tool, create_doc_on_canvas, for the one job those
// generic document tools can't do: bring a new document into existence.

import { createDocOfDatatype2 } from "@inkandswitch/patchwork-plugins";
import { datatypeIdsHint, loadDatatype } from "./datatypes.js";
import {
  DEFAULT_EMBED_H,
  DEFAULT_EMBED_W,
  buildEmbedRecord,
  indexAbove,
  placeClearOfContent,
  shapeIdForUrl,
} from "./embed-placement.js";

// The chat's `llm:skill` tool contract, restated here — the chat tool is a
// separate package, so its types can't be imported, only matched.
type LlmSkillTool = {
  name: string;
  description: string;
  parameters?: any;
};
type LlmSkillToolCtx = {
  repo: any;
  handle: any;
  element: HTMLElement;
  focusedUrl: string | undefined;
  applyAutomerge: (doc: any, path: any[], range: any, value: any) => void;
};

const INSTRUCTIONS = `
Create and edit tldraw canvases — diagrams, sticky-note boards, flowcharts,
wireframes, embedded-document layouts. Edit the document directly with read_doc
and automerge_op; the tldraw tool renders your changes live.

### Document

{ "store": { "<recordId>": <record>, ... }, "schema": { ... },
  "docs": [ ... ], "@patchwork": { "type": "tldraw5", ... } }

- \`store\` is a flat map of tldraw records keyed by their own id. Everything on
  the canvas lives here.
- \`schema\` is tldraw's serialized schema. NEVER touch it.
- \`docs\` is a FolderDoc-style DocLink[] (the canvas's \`script/**\` tree — a
  root \`main.js\` is a document script). Leave it alone unless asked.
- Never change \`@patchwork\`.type.

Record ids carry their type as a prefix and are the store keys:
\`document:document\` (singleton settings), \`page:page\` (the single page — this
datatype has exactly one), \`shape:<unique>\`, \`binding:<unique>\`,
\`asset:<unique>\`. Generate unique suffixes in the style of the existing ones
(a short random alphanumeric string is fine; keep it to [A-Za-z0-9_-]).

CRITICAL completeness rule: changes are pushed into tldraw's VALIDATING store,
one whole record at a time. A record that is missing a required prop, or that
carries a prop its shape type doesn't declare, is rejected — and a rejected
record can wedge the canvas until reload. So: write records COMPLETE, with
every field of the templates below, and copy the exact prop set of an existing
shape of the same type when in doubt (read_doc first).

Every shape record has the same envelope:

{ "id": "shape:<id>", "typeName": "shape", "type": "<geo|text|note|arrow|...>",
  "x": 0, "y": 0, "rotation": 0, "isLocked": false, "opacity": 1,
  "index": "a1", "parentId": "page:page", "meta": {}, "props": { ... } }

- \`x\`/\`y\` are page coordinates of the shape's top-left; y grows DOWNWARD.
- \`parentId\` is "page:page" (or "shape:<frameId>" for a child of a frame, in
  which case x/y are relative to the frame).
- \`index\` is the z-order key: a fractional index over the alphabet
  0-9A-Za-z. Ascending strings stack later shapes on top — use "a1", "a2", …
  "a9", "aA", "aB", … and keep them unique per parent.

### Text: richText

Every label-bearing shape stores its text as a ProseMirror doc, not a string:

{ "type": "doc", "content": [ { "type": "paragraph",
  "content": [ { "type": "text", "text": "Hello" } ] } ] }

One paragraph node per line. Empty label = { "type": "doc",
"content": [ { "type": "paragraph" } ] }. To change existing text, prefer
replace_text on the old string — it splices just that span, so a collaborator
typing in the same label doesn't get clobbered.

### Shape templates (complete prop sets)

geo — rectangle/ellipse/diamond/… , the workhorse box:
{ ..., "type": "geo", "props": {
  "geo": "rectangle", "w": 200, "h": 100, "growY": 0, "scale": 1,
  "color": "black", "labelColor": "black", "fill": "none", "dash": "draw",
  "size": "m", "font": "draw", "align": "middle", "verticalAlign": "middle",
  "url": "", "richText": { "type": "doc", "content": [ { "type": "paragraph",
    "content": [ { "type": "text", "text": "Box" } ] } ] } } }

text — a bare label, no box:
{ ..., "type": "text", "props": {
  "color": "black", "size": "m", "font": "draw", "textAlign": "start",
  "w": 200, "scale": 1, "autoSize": true,
  "richText": { ...as above... } } }
With "autoSize": true tldraw sizes it to the text and \`w\` is ignored; set
"autoSize": false to wrap at \`w\`.

note — a sticky note (no w/h; its size follows \`size\` and \`growY\`):
{ ..., "type": "note", "props": {
  "color": "yellow", "labelColor": "black", "size": "m", "font": "draw",
  "align": "middle", "verticalAlign": "middle", "growY": 0, "scale": 1,
  "url": "", "fontSizeAdjustment": 0, "textLastEditedBy": null,
  "richText": { ...as above... } } }

frame — a titled container; put shapes inside by setting their parentId to the
frame and their x/y relative to it:
{ ..., "type": "frame", "props": {
  "w": 720, "h": 480, "name": "Screen 1", "color": "black" } }

arrow — start/end are offsets RELATIVE to the arrow's own x/y:
{ ..., "type": "arrow", "props": {
  "kind": "arc", "start": { "x": 0, "y": 0 }, "end": { "x": 160, "y": 0 },
  "bend": 0, "elbowMidPoint": 0.5, "labelPosition": 0.5, "scale": 1,
  "arrowheadStart": "none", "arrowheadEnd": "arrow",
  "color": "black", "labelColor": "black", "fill": "none", "dash": "draw",
  "size": "m", "font": "draw",
  "richText": { "type": "doc", "content": [ { "type": "paragraph" } ] } } }

patchwork-doc — embeds another Patchwork document on the canvas, rendered by
its own tool. \`docUrl\` is an "automerge:…" url, \`docType\` its datatype id,
\`toolId\` "" to let the host pick the default tool:
{ ..., "type": "patchwork-doc", "props": {
  "w": 640, "h": 480, "docUrl": "automerge:<id>", "docName": "Notes",
  "docType": "<datatypeId>", "toolId": "" } }
Write this record yourself only for a document that ALREADY exists (a url the
user gave you, or one from \`docs\` / another shape). To put a NEW document on
the canvas, use create_doc_on_canvas — see below.

### Creating a new document as an embed

create_doc_on_canvas { datatype, x?, y?, w?, h? } creates a real, empty document
of an installed datatype and writes its \`patchwork-doc\` shape onto this canvas,
in one step. \`datatype\` is a datatype id and the only required argument.

- Get the id from the \`patchwork-datatypes\` skill's list_datatypes tool — it
  lists what this Patchwork actually has installed. If that skill isn't active,
  load_skill it first. Do not guess an id.
- Omit x/y and the embed is placed clear of the existing shapes; omit w/h for
  640×480. Don't pre-write a placeholder shape for it — the tool writes the
  record, and writing your own would leave a duplicate.
- It returns the new document's url, its datatype, and the shape id. The document
  starts EMPTY: read_doc that url next (which activates that datatype's own
  skill, if one is installed), then fill it in with automerge_op as usual.

Style values (any other value is rejected):
- color / labelColor: black, grey, light-violet, violet, blue, light-blue,
  yellow, orange, green, light-green, light-red, red, white
- fill: none, semi, solid, pattern, fill
- dash: draw, solid, dashed, dotted
- size: s, m, l, xl        font: draw, sans, serif, mono
- align / verticalAlign: start, middle, end     textAlign: start, middle, end
- geo: rectangle, ellipse, oval, triangle, diamond, rhombus, rhombus-2,
  pentagon, hexagon, octagon, star, cloud, heart, trapezoid, x-box,
  check-box, arrow-up, arrow-down, arrow-left, arrow-right
- arrowheadStart / arrowheadEnd: none, arrow, triangle, square, dot, diamond,
  inverted, bar, pipe
- kind: arc (curved, use \`bend\`) or elbow (right-angled, use \`elbowMidPoint\`)

### Connecting arrows to shapes: bindings

An arrow that should FOLLOW the shapes it joins needs a binding record per
end — the terminals are then recomputed by tldraw and \`start\`/\`end\` become
hints. \`fromId\` is always the arrow, \`toId\` the shape it attaches to:

{ "id": "binding:<id>", "typeName": "binding", "type": "arrow",
  "fromId": "shape:<arrowId>", "toId": "shape:<targetId>", "meta": {},
  "props": { "terminal": "start", "normalizedAnchor": { "x": 0.5, "y": 0.5 },
    "isExact": false, "isPrecise": false, "snap": "none" } }

Write two: one with "terminal": "start" → the source shape, one with
"terminal": "end" → the target. \`normalizedAnchor\` is a fraction of the
target's bounds ({0.5,0.5} = centre, which is what you want with
"isPrecise": false).

### Editing recipes (automerge_op)

Add a record (shape, binding) = ONE op:
  path ["store"], range "<recordId>", value = the complete record.
Add a whole diagram = one op per record; do them in order (shapes, then the
arrows, then the arrows' bindings).

Move a shape: path ["store","shape:<id>"], range "x", value 240 (same for "y").
Resize: path ["store","shape:<id>","props"], range "w", value 320.
Restyle: path ["store","shape:<id>","props"], range "color", value "blue".
Retext: replace_text {find: "old label", replace: "new label"} — or, to
  replace the whole label, assign the richText doc:
  path ["store","shape:<id>","props"], range "richText", value { "type": "doc", … }.
Rename the canvas (this is the document's title):
  path ["store","page:page"], range "name", value "Flowchart".
Reorder (z): path ["store","shape:<id>"], range "index", value "a5".

Delete a shape = delete its store key, AND delete every binding record whose
fromId/toId is that shape, AND any arrow left with no purpose, AND reparent or
delete shapes whose parentId pointed at it (a deleted frame's children):
  path ["store"], range "shape:<id>"   (no value)
Never delete \`page:page\` or \`document:document\`.

### Layout

Nothing auto-lays-out — you place everything, so do the arithmetic. Sensible
defaults: a labelled box 200×100; a column gap of 60–80px and a row gap of
120–160px between boxes; notes on a 220px grid. Keep bounding boxes
non-overlapping unless overlap is the point, and start a fresh diagram near
the existing content's bounds (or at 0,0 on an empty canvas) so the user
doesn't have to hunt for it. For an arrow drawn between two boxes without
bindings, set x/y to the source's edge midpoint and end to the delta to the
target's edge midpoint.

### Workflow

1. read_doc the focused canvas. Note the page id, the existing shapes' bounds
   (so you place new work clear of them), the largest \`index\` in use, and the
   exact prop set of any shape type you're about to copy.
2. Plan the shapes and their coordinates; say briefly what you're drawing.
3. Apply the edits with automerge_op — one op per new record, complete records
   only, arrows' bindings right after their arrow.
4. read_doc to verify the records landed as written, then summarize.
`.trim();

// ── create_doc_on_canvas ─────────────────────────────────────────────────────
// The one thing the instructions above can't do with automerge_op alone: bring
// a new Patchwork document into existence. Creating it through the datatype's
// own `init` (the same createDocOfDatatype2 the canvas's new-doc tool and the
// sideboard's "+" both call) is what makes it a valid document of its type
// rather than a hand-guessed blob.

const CREATE_DOC_ON_CANVAS: LlmSkillTool = {
  name: "create_doc_on_canvas",
  description:
    "Create a NEW, empty Patchwork document of an installed datatype and embed it on the focused tldraw canvas as a patchwork-doc shape. Takes the datatype id (see the patchwork-datatypes skill's list_datatypes); optional x/y/w/h, else it is auto-placed clear of the existing shapes at 640x480. Returns the new document's url — read_doc it to fill it in.",
  parameters: {
    type: "object",
    properties: {
      datatype: {
        type: "string",
        description:
          "datatype id, e.g. from list_datatypes (NOT a display name)",
      },
      x: { type: "number", description: "optional page x (top-left)" },
      y: { type: "number", description: "optional page y (top-left)" },
      w: { type: "number", description: "optional width (default 640)" },
      h: { type: "number", description: "optional height (default 480)" },
    },
    required: ["datatype"],
  },
};

async function createDocOnCanvas(
  args: any,
  ctx: LlmSkillToolCtx
): Promise<unknown> {
  const datatypeId = String(args?.datatype ?? "").trim();
  if (!datatypeId) {
    return `Error: create_doc_on_canvas needs a \`datatype\` id. Installed: ${datatypeIdsHint()}`;
  }
  if (!ctx.focusedUrl) {
    return "Error: no focused document — create_doc_on_canvas writes into the tldraw canvas you have open.";
  }

  const canvas = await ctx.repo.find(ctx.focusedUrl);
  const canvasDoc: any = canvas.doc();
  if (!canvasDoc || typeof canvasDoc.store !== "object") {
    return `Error: the focused document (${ctx.focusedUrl}) is not a tldraw canvas — it has no \`store\`.`;
  }

  const datatype = await loadDatatype(datatypeId);
  if (!datatype) {
    return `Error: no installed datatype "${datatypeId}". Installed: ${datatypeIdsHint()}`;
  }

  // `createDocOfDatatype2` is typed against an older @automerge/automerge-repo
  // Repo; cast to bridge the version skew (the same thing tldraw5's new-doc
  // tool does).
  const docHandle = await (
    createDocOfDatatype2 as unknown as (
      d: unknown,
      r: unknown
    ) => Promise<{ url: string; doc(): unknown }>
  )(datatype, ctx.repo);
  const docUrl = docHandle.url;

  // Register with the sync server when the host exposes a keyhive, as the
  // sideboard and folder do on create. Absent hive = local-only host, which is
  // fine; a failure here must not lose the document we just made.
  try {
    await (ctx.element as any)?.hive?.addSyncServerPullToDoc?.(docUrl);
  } catch (e) {
    console.warn("[corkboard] sync-server registration failed for", docUrl, e);
  }

  let docName = datatype.name || datatypeId;
  try {
    docName = (datatype as any).module?.getTitle?.(docHandle.doc()) || docName;
  } catch {
    // A datatype whose getTitle chokes on a fresh doc still gets an embed.
  }

  const store = canvasDoc.store as Record<string, any>;
  const auto = placeClearOfContent(store);
  const shapeId = shapeIdForUrl(docUrl);
  const record = buildEmbedRecord({
    shapeId,
    index: indexAbove(store),
    x: Number.isFinite(Number(args?.x)) ? Number(args.x) : auto.x,
    y: Number.isFinite(Number(args?.y)) ? Number(args.y) : auto.y,
    w: Number.isFinite(Number(args?.w)) ? Number(args.w) : DEFAULT_EMBED_W,
    h: Number.isFinite(Number(args?.h)) ? Number(args.h) : DEFAULT_EMBED_H,
    docUrl,
    docName,
    docType: datatypeId,
  });

  canvas.change((d: any) => {
    ctx.applyAutomerge(d, ["store"], shapeId, record);
  });

  return {
    url: docUrl,
    docType: datatypeId,
    docName,
    shapeId,
    canvasUrl: ctx.focusedUrl,
    x: record.x,
    y: record.y,
    next: `The document is empty. read_doc ${docUrl} and fill it in — its own skill (if installed) activates when you read it.`,
  };
}

export const skill = {
  instructions: INSTRUCTIONS,
  tools: [CREATE_DOC_ON_CANVAS],
  async runTool(name: string, args: any, ctx: LlmSkillToolCtx) {
    if (name !== "create_doc_on_canvas") return undefined;
    return createDocOnCanvas(args, ctx);
  },
};
