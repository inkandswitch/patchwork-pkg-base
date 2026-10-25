import type { Range } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import * as providers from "@inkandswitch/patchwork-providers";

/**
 * Served by the patch-layers provider (`patchwork:patch-highlights`): whether
 * to highlight what laid patches change, and how each patch looks.
 */
export type PatchHighlights = {
  on: boolean;
  patches: Record<string, { fill: string; wash: string; name: string }>;
};

type Highlight = {
  start: number;
  end: number;
  patch: string;
  replaced?: string;
  whole?: true;
};

// `patchHighlights` is newer than some providers releases the import map may
// serve; without it there's simply nothing to highlight.
const read = (providers as Record<string, unknown>).patchHighlights as
  | ((handle: unknown, path: readonly (string | number)[]) => Highlight[])
  | undefined;

/** The runs of the string at `path` that patches decide, as shown. */
export function readPatchHighlights(
  handle: unknown,
  path: readonly (string | number)[]
): Highlight[] {
  try {
    return read?.(handle, path) ?? [];
  } catch (err) {
    console.warn("[codemirror] couldn't read patch highlights:", err);
    return [];
  }
}

// The patch's name, in a little tag at the start of what it changes.
class PatchTag extends WidgetType {
  readonly name: string;
  readonly fill: string;
  readonly replaced: string | undefined;
  readonly empty: boolean;

  constructor(
    name: string,
    fill: string,
    replaced: string | undefined,
    empty: boolean
  ) {
    super();
    this.name = name;
    this.fill = fill;
    this.replaced = replaced;
    this.empty = empty;
  }

  eq(other: PatchTag): boolean {
    return (
      other.name === this.name &&
      other.fill === this.fill &&
      other.replaced === this.replaced &&
      other.empty === this.empty
    );
  }

  toDOM(): HTMLElement {
    const tag = document.createElement("span");
    tag.className = "cm-patch-tag";
    tag.textContent = this.name;
    tag.style.cssText = [
      "display:inline-block",
      "font:11px/1.5 system-ui,sans-serif",
      "padding:0 5px",
      "margin-right:2px",
      "vertical-align:text-top",
      "background:#fff8c8",
      "color:#141414",
      `border:1px solid ${this.fill}`,
      "transform:skew(-8deg)",
      "user-select:none",
    ].join(";");
    tag.title = this.replaced
      ? `${this.name} · the document has: ${this.replaced}`
      : this.name;
    // A patch that only deletes shows what it took out, struck through.
    if (this.empty && this.replaced) {
      const gone = document.createElement("s");
      gone.textContent = ` ${this.replaced}`;
      gone.style.cssText = `text-decoration-color:${this.fill};opacity:.7`;
      tag.append(gone);
    }
    return tag;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** A wash over each patched run, and a tag naming its patch. */
export function buildPatchDecorations(
  highlights: Highlight[],
  look: PatchHighlights
): Range<Decoration>[] {
  const out: Range<Decoration>[] = [];
  for (const h of highlights) {
    const patch = look.patches[h.patch];
    if (!patch) continue;
    const empty = h.end <= h.start;
    out.push(
      Decoration.widget({
        widget: new PatchTag(patch.name, patch.fill, h.replaced, empty),
        side: -1,
      }).range(h.start)
    );
    if (empty) continue;
    out.push(
      Decoration.mark({
        attributes: {
          class: "cm-patched",
          style: `background:${patch.wash};box-shadow:inset 0 -2px 0 ${patch.fill}`,
          title: h.replaced
            ? `${patch.name} · the document has: ${h.replaced}`
            : patch.name,
        },
      }).range(h.start, h.end)
    );
  }
  return out;
}
