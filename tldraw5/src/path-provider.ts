// What a canvas contains, for paths and the sidebar: the documents its `docs`
// links to (as a folder's, so a walk through a canvas finds its script files
// whichever provider walks it), then its shapes, each a sub-document at
// `store/<shape id>`. Kept free of tldraw so loading it loads nothing else.
//
// A shape's name is its text (or its type) and the tail of its id, so it's
// readable, stays put while the text does, and is unique within the canvas.
import {
  isValidAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo/slim";

// patchwork-filesystem's PathProvider, which the installed version predates.
// The host checks the shape when it loads a provider.
type Child =
  | { name: string; link: AutomergeUrl }
  | { name: string; sub: (string | number)[] };
type Lookup = { child: Child; consumed: number };
type PathProvider = {
  kind: string;
  matches(doc: unknown): boolean;
  lookup(node: unknown, names: string[]): Lookup | undefined;
  list(node: unknown): Child[];
};

type ShapeRecord = {
  id: string;
  typeName: "shape";
  type?: string;
  index?: string;
  props?: Record<string, unknown>;
};

type Canvas = {
  store: Record<string, unknown>;
  docs?: { name?: unknown; url?: unknown }[];
};

const isCanvas = (node: unknown): node is Canvas => {
  const store = (node as Canvas | undefined)?.store;
  return !!store && typeof store === "object" && !Array.isArray(store);
};

const isShape = (record: unknown): record is ShapeRecord =>
  !!record &&
  typeof record === "object" &&
  (record as ShapeRecord).typeName === "shape" &&
  typeof (record as ShapeRecord).id === "string";

// As the folder provider reads a link: a url, or an ImmutableString of one.
const asLink = (url: unknown): AutomergeUrl | undefined => {
  const value = url == null ? undefined : String(url);
  return isValidAutomergeUrl(value) ? value : undefined;
};

/** The plain text of a rich text (TipTap) value: its `text` leaves, in order. */
function richText(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) richText(item, out);
  else if (value && typeof value === "object") {
    const { text, content } = value as { text?: unknown; content?: unknown };
    if (text != null) out.push(String(text));
    if (content) richText(content, out);
  }
  return out;
}

const MAX_LABEL = 40;

/** What a shape says, or what it is. */
export function shapeLabel(shape: ShapeRecord): string {
  const props = shape.props ?? {};
  const said = [
    richText(props.richText).join(" "),
    props.text,
    props.name,
    props.docName,
  ]
    .map((value) => (value == null ? "" : String(value).replace(/\s+/g, " ").trim()))
    .find(Boolean);
  const label = said || String(props.geo ?? shape.type ?? "shape");
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1).trimEnd()}…` : label;
}

// Names are path segments.
const clean = (name: string) => name.replace(/\//g, "-");

const idOf = (shape: ShapeRecord) => shape.id.replace(/^shape:/, "");
// The tail, not the head: a patchwork-doc shape's id starts with its doc's url.
const shortId = (shape: ShapeRecord) => idOf(shape).slice(-8);

const children = new WeakMap<object, Child[]>();

function listCanvas(node: Canvas): Child[] {
  const memo = children.get(node);
  if (memo) return memo;

  const links: Child[] = [];
  for (const entry of Array.isArray(node.docs) ? node.docs : []) {
    const link = asLink(entry?.url);
    if (link) links.push({ name: String(entry.name), link });
  }
  const taken = new Set(links.map((child) => child.name));

  const shapes = Object.values(node.store)
    .filter(isShape)
    .sort((a, b) => {
      const [x, y] = [String(a.index ?? ""), String(b.index ?? "")];
      return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  const named = shapes.map((shape) => ({
    shape,
    name: clean(`${shapeLabel(shape)} (${shortId(shape)})`),
  }));
  // Two shapes alike in text and id tail (or one named like a linked doc) go by their whole id.
  const counts = new Map<string, number>();
  for (const { name } of named) counts.set(name, (counts.get(name) ?? 0) + 1);
  const result = [...links];
  for (const { shape, name } of named) {
    const unique =
      counts.get(name) === 1 && !taken.has(name)
        ? name
        : clean(`${shapeLabel(shape)} (${idOf(shape)})`);
    if (taken.has(unique)) continue;
    taken.add(unique);
    result.push({ name: unique, sub: ["store", shape.id] });
  }
  children.set(node, result);
  return result;
}

export const provider: PathProvider = {
  kind: "tldraw",
  matches: isCanvas,
  lookup(node, names): Lookup | undefined {
    if (!isCanvas(node)) return undefined;
    const child = listCanvas(node).find((child) => child.name === names[0]);
    return child ? { child, consumed: 1 } : undefined;
  },
  list(node) {
    return isCanvas(node) ? listCanvas(node) : [];
  },
};
