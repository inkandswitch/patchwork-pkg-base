// Patch layers are in @inkandswitch/patchwork-providers but not in a published
// release yet. At runtime the import map serves whatever the shell ships; this
// gives the build the types until the dependency can be bumped. Delete it then.
import type {
  AutomergeUrl,
  DocHandle,
  Repo,
  UrlHeads,
} from "@automerge/automerge-repo/slim";

declare module "@inkandswitch/patchwork-providers" {
  type Prop = string | number;
  type Cursor = string;
  type MarkValue = string | number | boolean;

  export type PathPatch = { path: Prop[]; value?: unknown; at?: UrlHeads };
  export type TextPatch = {
    path: Prop[];
    text: {
      from: Cursor;
      to?: Cursor;
      around?: [Cursor, Cursor];
      insert: string;
      id?: string;
      over?: string[];
    };
    at?: UrlHeads;
  };
  export type MarkPatch = {
    path: Prop[];
    mark: {
      name: string;
      value: MarkValue | null;
      from?: Cursor;
      to?: Cursor;
      within?: string;
      start?: number;
      end?: number;
    };
    at?: UrlHeads;
  };
  export type RunPatch = { path: Prop[]; values: unknown[]; at?: UrlHeads };
  export type PatchEntry = PathPatch | TextPatch | MarkPatch | RunPatch;
  export type PatchDoc = {
    "@patchwork": { type: "patch" };
    on: AutomergeUrl;
    at: UrlHeads;
    patches: PatchEntry[];
    record?: boolean;
    landedAt?: UrlHeads;
  };
  export type EntryReading = {
    kind: "put" | "remove" | "text" | "mark";
    path: Prop[];
    stale: boolean;
    then?: unknown;
    now?: unknown;
    range?: { start: number; end: number };
    before?: string;
    after?: string;
  };
  export type OpsError = { index: number; code: string; message: string };
  export type PatchHighlight = {
    start: number;
    end: number;
    patch: AutomergeUrl;
    replaced?: string;
    whole?: true;
    index?: number;
    id?: string;
    base?: { start: number; end: number };
  };
  export function patchHighlights(
    handle: unknown,
    path: readonly Prop[]
  ): PatchHighlight[];
  // The Automerge patch shapes `fromAutomergePatches` reads.
  export type AutomergeOp =
    | { action: "put"; path: Prop[]; value: unknown }
    | { action: "del"; path: Prop[]; length?: number }
    | { action: "splice"; path: Prop[]; value: string }
    | { action: "insert"; path: Prop[]; values: unknown[] }
    | { action: "inc"; path: Prop[]; value: number }
    | {
        action: "mark";
        path: Prop[];
        marks: { name: string; value: MarkValue; start: number; end: number }[];
      }
    | { action: "unmark"; path: Prop[]; name: string; start: number; end: number };

  export function providePatchLayers(
    element: HTMLElement,
    options: { repo: Repo; folder: AutomergeUrl | Promise<AutomergeUrl> }
  ): () => void;
  export function createPatch<T>(
    repo: Pick<Repo, "create">,
    target: DocHandle<T>,
    patches?: PatchEntry[]
  ): DocHandle<PatchDoc>;
  export function textPatch<T>(
    target: DocHandle<T>,
    path: Prop[],
    start: number,
    end: number,
    insert: string,
    heads?: UrlHeads
  ): TextPatch;
  export function markPatch<T>(
    target: DocHandle<T>,
    path: Prop[],
    start: number,
    end: number,
    name: string,
    value: MarkValue | null,
    heads?: UrlHeads
  ): MarkPatch;
  export function fromAutomergePatches<T>(
    target: DocHandle<T>,
    ops: readonly AutomergeOp[],
    heads?: UrlHeads
  ): { entries: PatchEntry[]; errors: OpsError[] };
  export function readEntry<T>(
    target: DocHandle<T>,
    patch: Pick<PatchDoc, "at">,
    entry: PatchEntry
  ): EntryReading;
  export function isEntryStale<T>(
    target: DocHandle<T>,
    patch: Pick<PatchDoc, "at">,
    entry: PatchEntry
  ): boolean;
  export function isPatchStale<T>(target: DocHandle<T>, patch: PatchDoc): boolean;
  export function isTextPatch(entry: PatchEntry): entry is TextPatch;
  export function isMarkPatch(entry: PatchEntry): entry is MarkPatch;
  export function isPathPatch(entry: PatchEntry): entry is PathPatch;
  export function isRunPatch(entry: PatchEntry): entry is RunPatch;
  export function landPatch<T>(
    target: DocHandle<T>,
    layer: DocHandle<PatchDoc>
  ): Map<string, number>;
}
