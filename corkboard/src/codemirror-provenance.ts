// Provenance rendering for CodeMirror editors, shipped with the corkboard.
// Registered as a `codemirror:extension` FACTORY: codemirror-base loads it
// through the plugin registry (late-bound — no build-time dependency either
// way) and calls it with the editor's Patchwork context. The extension:
//
//   - subscribes to `patchwork:provenance` for the edited doc and decorates
//     every source range (text another document was generated from) with a
//     dotted underline in the link accent;
//   - draws the stronger tint when the shared focus selection/highlight
//     overlaps a range;
//   - on selection change, pushes the targets linked to the ranges under the
//     cursor into the shared focus selection, so views of the generated doc
//     highlight what came from the selected text.
//
// Outside a provenance provider (see `ProvenanceProvider`) the subscription
// is never answered and the whole extension stays inert.

import {
  RangeSet,
  StateEffect,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
} from "@codemirror/view";
import { subscribe } from "@inkandswitch/patchwork-providers";
import type {
  AutomergeUrl,
  DocHandle,
  Repo,
} from "@automerge/automerge-repo/slim";
import type { ProvenanceLink } from "./provenance.js";

// Mirrors codemirror-base's CodeMirrorExtensionContext structurally (the
// packages are standalone, so the type is not imported).
export type CodeMirrorExtensionContext = {
  handle: DocHandle<unknown>;
  element: HTMLElement;
  repo: Repo;
};

type FocusDoc = {
  selection: Record<AutomergeUrl, true>;
  highlight: Record<AutomergeUrl, true>;
};

// A provenance source range in the edited doc, resolved to a live ref
// handle, with the target refs (in other docs) it links to.
type ProvenanceSource = {
  handle: DocHandle<unknown>;
  targetUrls: AutomergeUrl[];
};

export function provenanceExtension(
  ctx: CodeMirrorExtensionContext
): Extension {
  // Dispatched to wake the view when async data (links, focus) lands.
  const refresh = StateEffect.define<null>();

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;

      private view: EditorView;
      private sources: ProvenanceSource[] = [];
      private emphasis: DocHandle<unknown>[] = [];
      private focusUrls = new Set<string>();
      private focusHandle: DocHandle<FocusDoc> | undefined;
      private lastPushedKey = "";
      private destroyed = false;
      private unsubscribers: (() => void)[] = [];
      private onFocusChange = () => {
        void this.refreshEmphasis();
      };

      constructor(view: EditorView) {
        this.view = view;
        this.unsubscribers.push(
          subscribe<ProvenanceLink[]>(
            ctx.element,
            { type: "patchwork:provenance", url: ctx.handle.url },
            (links) => void this.applyLinks(links)
          ),
          subscribe<AutomergeUrl>(
            ctx.element,
            { type: "patchwork:focus" },
            (url) => void this.attachFocus(url)
          )
        );
      }

      // Ranges are re-read from the ref handles on every view update: doc
      // changes move them, and the `refresh` effect (async data arriving)
      // lands here too. Building is cheap — a handful of ranges.
      update() {
        this.decorations = this.build();
      }

      destroy() {
        this.destroyed = true;
        for (const unsubscribe of this.unsubscribers) unsubscribe();
        this.focusHandle?.off("change", this.onFocusChange);
      }

      // Called from the selection update listener below — which runs AFTER
      // the base editor's own listener has replaced the shared selection with
      // the cursor's ref url — so this only merges targets in on top.
      pushTargetsForSelection(from: number, to: number) {
        const handle = this.focusHandle;
        if (!handle) return;
        const targets = this.targetsInRange(from, to);
        const key = `${from}:${to}|${targets.join("|")}`;
        if (key === this.lastPushedKey) return;
        this.lastPushedKey = key;
        if (targets.length === 0) return;
        handle.change((doc) => {
          if (!doc.selection) doc.selection = {};
          for (const url of targets) doc.selection[url] = true;
        });
      }

      // Target refs of every source range that overlaps [from, to].
      private targetsInRange(from: number, to: number): AutomergeUrl[] {
        const targets = new Set<AutomergeUrl>();
        for (const source of this.sources) {
          const positions = source.handle.rangePositions();
          if (!positions) continue;
          const [start, end] = positions;
          if (start === end || to < start || from > end) continue;
          for (const url of source.targetUrls) targets.add(url);
        }
        return [...targets];
      }

      // Scopes links to the ones whose SOURCE lives in this doc, dedupes by
      // source ref, and resolves each source to a live handle.
      private async applyLinks(links: ProvenanceLink[]) {
        const targetsBySource = new Map<AutomergeUrl, Set<AutomergeUrl>>();
        for (const link of links) {
          if (!link.sourceUrl.startsWith(ctx.handle.url)) continue;
          let targets = targetsBySource.get(link.sourceUrl);
          if (!targets) {
            targetsBySource.set(link.sourceUrl, (targets = new Set()));
          }
          targets.add(link.targetUrl);
        }
        const sources: ProvenanceSource[] = [];
        for (const [sourceUrl, targets] of targetsBySource) {
          sources.push({
            handle: await ctx.repo.find(sourceUrl),
            targetUrls: [...targets],
          });
        }
        if (this.destroyed) return;
        this.sources = sources;
        this.poke();
      }

      private async attachFocus(url: AutomergeUrl) {
        this.focusHandle?.off("change", this.onFocusChange);
        const handle = await ctx.repo.find<FocusDoc>(url);
        if (this.destroyed) return;
        this.focusHandle = handle;
        handle.on("change", this.onFocusChange);
        await this.refreshEmphasis();
      }

      // Focus refs (selection ∪ highlight) scoped to this doc, resolved to
      // handles so `build` can test overlap against the source ranges. The
      // raw url set is kept too: a source range is also emphasised when the
      // focus holds one of its TARGETS (e.g. an element selected on a
      // Petrinaut canvas), which never resolves into this doc.
      private async refreshEmphasis() {
        const doc = this.focusHandle?.doc();
        const urls = [
          ...Object.keys(doc?.selection ?? {}),
          ...Object.keys(doc?.highlight ?? {}),
        ] as AutomergeUrl[];
        const refs: DocHandle<unknown>[] = [];
        for (const url of urls) {
          if (url.startsWith(ctx.handle.url)) {
            refs.push(await ctx.repo.find(url));
          }
        }
        if (this.destroyed) return;
        this.focusUrls = new Set(urls);
        this.emphasis = refs;
        this.poke();
      }

      // Safe to dispatch directly: every caller sits behind an `await`, so
      // the view is never mid-update here.
      private poke() {
        if (this.destroyed) return;
        this.view.dispatch({ effects: refresh.of(null) });
      }

      private build(): DecorationSet {
        const out: Range<Decoration>[] = [];
        for (const source of this.sources) {
          const positions = source.handle.rangePositions();
          if (!positions) continue;
          const [start, end] = positions;
          if (start === end) continue;
          const isEmphasised =
            this.emphasis.some((ref) => ref.overlaps(source.handle)) ||
            source.targetUrls.some((url) => this.focusUrls.has(url));
          out.push(
            Decoration.mark({
              attributes: { style: sourceStyle(isEmphasised) },
            }).range(start, end)
          );
        }
        return RangeSet.of(out, true);
      }
    },
    { decorations: (instance) => instance.decorations }
  );

  // Registered after the base editor's own selection listener (user
  // extensions load later in the editor's extension array), so the merge in
  // pushTargetsForSelection lands on the freshly replaced selection map.
  const selectionListener = EditorView.updateListener.of((update) => {
    if (!update.selectionSet) return;
    const sel = update.state.selection.main;
    update.view.plugin(plugin)?.pushTargetsForSelection(sel.from, sel.to);
  });

  return [plugin, selectionListener];
}

// Same highlighter-over-paper scheme as codemirror-base's comment targets,
// but on the link accent: the tint is anchored to the editor surface so it
// tracks the theme, and the dotted underline reads as "this points
// somewhere". Emphasised (focus overlaps the range) draws the stronger tint.
function sourceStyle(isEmphasised: boolean): string {
  const paper = isEmphasised ? "56%" : "85%";
  return `
    border-bottom: 2px dotted var(--studio-link);
    background-color: color-mix(in oklch, var(--studio-link), var(--text-editor-fill) ${paper});
  `;
}
