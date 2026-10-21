// What is this thing on screen? Everything in the frame is mounted through a
// `<patchwork-view>`, so "what is this" means: find the patchwork-views between
// the pointer and the page root, and read off each one what it was asked to
// show (a tool on a doc, or a component) and who registered that plugin.
//
// Nothing here draws anything; inspector.ts does that.

import { getRegistry } from "@inkandswitch/patchwork-plugins";

/** What sort of view a patchwork-view is. */
export type ViewKind =
  /** a tool showing a document (`tool-id` + `doc-url`) */
  | "tool"
  /** a component (`component="…"`), usually chrome or a provider */
  | "component"
  /** the isolation wall: a sandboxed iframe the host can't look into */
  | "isolated";

/** How we know which tool a view is running. */
export type ToolSource =
  /** the element's `tool-id` attribute names it */
  | "asked"
  /** no `tool-id`; we saw it mount and pick a default */
  | "default"
  /** no `tool-id`, and it mounted before we were watching */
  | "unknown";

export interface ViewInfo {
  element: HTMLElement;
  kind: ViewKind;
  /** the tool or component id */
  id?: string;
  /** for tools: where the id came from */
  toolSource?: ToolSource;
  /** the plugin's display name, from the registry */
  name?: string;
  /** the module that registered the plugin */
  importUrl?: string;
  /** true when the id isn't in the registry (not installed, or gone) */
  missing?: boolean;
  /** the document the view is showing */
  docUrl?: string;
}

const VIEW_TAG = "patchwork-view";
const ISOLATION_COMPONENT = "patchwork-isolation";

// A view with no `tool-id` picks a default tool when it mounts and announces it
// in a `patchwork:mounted` event. We remember those so we can say which tool it
// picked. Views that mounted before we started listening stay "unknown".
const mountedTools = new WeakMap<Element, string>();
let mountWatchers = 0;

function onMounted(event: Event) {
  const detail = (event as CustomEvent).detail;
  const target = event.composedPath()[0];
  if (target instanceof Element && typeof detail?.toolId === "string") {
    mountedTools.set(target, detail.toolId);
  }
}

/** Start remembering which tool each view mounts. Returns a stop function. */
export function watchMounts(root: Document = document): () => void {
  if (mountWatchers++ === 0) {
    root.addEventListener("patchwork:mounted", onMounted, true);
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    if (--mountWatchers === 0) {
      root.removeEventListener("patchwork:mounted", onMounted, true);
    }
  };
}

/** For tests: pretend we saw `element` mount `toolId`. */
export function noteMounted(element: Element, toolId: string) {
  mountedTools.set(element, toolId);
}

/** The parent of an element, stepping out of shadow roots to their host. */
export function parentOf(node: Element): Element | null {
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/**
 * The patchwork-views that contain `node` (itself included), outermost first.
 * Walks through shadow roots, so a tool inside a tool inside the frame comes
 * back as [frame bits…, outer tool, inner tool].
 */
export function viewsAround(node: Element | null): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let el = node; el; el = parentOf(el)) {
    if (el.localName === VIEW_TAG) out.push(el as HTMLElement);
  }
  return out.reverse();
}

/**
 * The deepest element at a point, looking inside open shadow roots. `skip`
 * lets the inspector ignore its own overlay.
 */
export function elementAt(
  x: number,
  y: number,
  skip: (el: Element) => boolean
): Element | null {
  let root: Document | ShadowRoot = document;
  let found: Element | null = null;
  for (let depth = 0; depth < 32; depth++) {
    const hit: Element | undefined = root
      .elementsFromPoint(x, y)
      .find((el) => !skip(el));
    if (!hit || hit === found) break;
    found = hit;
    if (!hit.shadowRoot) break;
    root = hit.shadowRoot;
  }
  return found;
}

function lookup(
  registry: string,
  id: string | undefined
): Pick<ViewInfo, "name" | "importUrl" | "missing"> {
  if (!id) return {};
  try {
    const plugin = getRegistry<any>(registry).get(id) as
      | { name?: unknown; importUrl?: unknown }
      | undefined;
    if (!plugin) return { missing: true };
    return {
      name: typeof plugin.name === "string" ? plugin.name : undefined,
      importUrl:
        typeof plugin.importUrl === "string" ? plugin.importUrl : undefined,
    };
  } catch {
    return { missing: true };
  }
}

interface IsolationProps {
  selectedDocUrl?: string;
  selectedToolId?: string;
}

/** The isolation wall carries what it was told to show in a JSON <script>. */
function isolationProps(el: HTMLElement): IsolationProps {
  const script = [...el.children].find(
    (kid) =>
      kid.localName === "script" && kid.hasAttribute("data-root-component-data")
  );
  if (!script?.textContent) return {};
  try {
    const props = JSON.parse(script.textContent);
    return {
      selectedDocUrl:
        typeof props?.selectedDocUrl === "string"
          ? props.selectedDocUrl
          : undefined,
      selectedToolId:
        typeof props?.selectedToolId === "string"
          ? props.selectedToolId
          : undefined,
    };
  } catch {
    return {};
  }
}

/** Read what a patchwork-view is showing and who made it. */
export function describe(el: HTMLElement): ViewInfo {
  const component = el.getAttribute("component");

  if (component === ISOLATION_COMPONENT) {
    const props = isolationProps(el);
    return {
      element: el,
      kind: "isolated",
      id: props.selectedToolId,
      toolSource: props.selectedToolId ? "asked" : "unknown",
      docUrl: props.selectedDocUrl,
      ...lookup("patchwork:tool", props.selectedToolId),
    };
  }

  if (component) {
    return {
      element: el,
      kind: "component",
      id: component,
      docUrl: el.getAttribute("url") ?? undefined,
      ...lookup("patchwork:component", component),
    };
  }

  const asked = el.getAttribute("tool-id") || undefined;
  const seen = mountedTools.get(el);
  const id = asked ?? seen;
  return {
    element: el,
    kind: "tool",
    id,
    toolSource: asked ? "asked" : seen ? "default" : "unknown",
    docUrl: el.getAttribute("doc-url") ?? undefined,
    ...lookup("patchwork:tool", id),
  };
}

/** A short name for a view, for chips and the hover tag. */
export function labelOf(info: ViewInfo): string {
  if (info.kind === "isolated") return "isolated pane";
  return info.name ?? info.id ?? "a view";
}

/**
 * Where a view is on screen. Some views are `display: contents` and have no
 * box of their own, so fall back to the union of their children's boxes.
 */
export function rectOf(el: Element): DOMRect {
  const own = el.getBoundingClientRect();
  if (own.width || own.height) return own;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const kids = [...el.children, ...(el.shadowRoot?.children ?? [])];
  for (const kid of kids) {
    const r = rectOf(kid);
    if (!r.width && !r.height) continue;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  if (left === Infinity) return own;
  return new DOMRect(left, top, right - left, bottom - top);
}

/** `automerge:4f2a9c…` — enough to tell docs apart at a glance. */
export function shortUrl(url: string): string {
  if (!url.startsWith("automerge:")) return url;
  const id = url.slice("automerge:".length).replace(/[@?#/].*$/, "");
  return id.length > 8 ? `automerge:${id.slice(0, 6)}…` : url;
}

/** Heads are long hashes; seven characters each is plenty to see change. */
export function shortHeads(heads: readonly string[]): string {
  if (!heads.length) return "(empty doc)";
  return heads.map((h) => h.slice(0, 7)).join(" ");
}
