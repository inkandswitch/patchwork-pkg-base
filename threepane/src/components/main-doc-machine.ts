/**
 * The main document view's loading lifecycle, as one pure function.
 *
 *   waiting-repo -> finding -> unavailable (retry, backoff) | invalid | deleted
 *                           -> no-tool | open
 *   open: opening -> rendered, or tool-failed / tool-timeout / not-shared /
 *         cant-tell along the way
 *   bare: no <repo-provider> at all, so patchwork-view does it all alone
 *
 * `step(state, event)` has no side effects and reads no clock. An event that
 * doesn't apply returns the very same state object. Finds, tool loads and
 * access checks are async and can land late, so each carries a token (the
 * find `epoch`, the tool `attempt`, the access `seq`) and `step` drops the
 * ones that are no longer the latest. The component does the finding and
 * timing, in response to the state, and reports back only with events.
 */

export type Access = "unchecked" | "shared" | "not-shared" | "unknown";

/** What the driver worked out the doc should be opened with. */
export type Resolution =
  | { kind: "open"; toolId: string | undefined }
  | {
      kind: "no-tool";
      type: string;
      suggestion: string | undefined;
      anything: { id: string; name: string } | undefined;
    };

/** What a doc that's been found and has a tool to open it knows. */
export type OpenData = {
  // undefined when the doc has no datatype: patchwork-view says what's wrong
  toolId: string | undefined;
  tool: "loading" | "loaded" | "failed" | "timeout";
  error: string | undefined;
  // which try at loading the tool this is
  attempt: number;
  access: Access;
  // the latest access check applied, so an older answer can't undo it
  accessSeq: number;
  // patchwork-view reported a tool rendered
  mounted: boolean;
  // remounts patchwork-view when bumped
  view: number;
};

export type OpenKind =
  | "opening"
  | "rendered"
  | "tool-failed"
  | "tool-timeout"
  | "not-shared"
  | "cant-tell";

export type OpenState = {
  [K in OpenKind]: { kind: K } & OpenData;
}[OpenKind];

export type State =
  | { kind: "waiting-repo" }
  | { kind: "bare" }
  | { kind: "finding"; epoch: number }
  | { kind: "unavailable"; epoch: number; misses: number; view: number }
  | { kind: "invalid" }
  | { kind: "deleted" }
  | {
      kind: "no-tool";
      type: string;
      suggestion: string | undefined;
      anything: { id: string; name: string } | undefined;
    }
  | OpenState;

export type Event =
  | { type: "repo-ready" }
  | { type: "no-provider" }
  // ask again (retry timer, repo progress, back online)
  | { type: "look" }
  | { type: "found"; epoch: number; resolution: Resolution }
  | { type: "missed"; epoch: number }
  | { type: "invalid"; epoch: number }
  // from a find that said so (with its epoch), or from the handle (without)
  | { type: "deleted"; epoch?: number }
  // the tools or the asked-for tool changed
  | { type: "resolved"; resolution: Resolution }
  | { type: "mounted" }
  | { type: "tool-loaded"; toolId: string; attempt: number }
  | { type: "tool-failed"; toolId: string; attempt: number; message: string }
  | { type: "tool-timeout"; toolId: string; attempt: number }
  | { type: "retry-tool" }
  | { type: "access"; seq: number; result: "shared" | "not-shared" | "unknown" };

export const initial: State = { kind: "waiting-repo" };

const OPEN_KINDS: readonly string[] = [
  "opening",
  "rendered",
  "tool-failed",
  "tool-timeout",
  "not-shared",
  "cant-tell",
] satisfies OpenKind[];

export function isOpen(state: State): state is OpenState {
  return OPEN_KINDS.includes(state.kind);
}

// the kinds that keep a patchwork-view underneath. a tool that failed or
// timed out has none to offer; the rest leave it be so it can recover
const HOSTED: readonly string[] = [
  "bare",
  "unavailable",
  "opening",
  "rendered",
  "not-shared",
  "cant-tell",
];
export const hostsView = (state: State) => HOSTED.includes(state.kind);

/** Which remount of patchwork-view this state belongs to, when it has one. */
export function viewOf(state: State): number | undefined {
  if (!hostsView(state)) return undefined;
  return "view" in state ? state.view : 0;
}

// one place decides which card an open doc shows, so two never do together
function kindOf(o: OpenData): OpenKind {
  if (o.mounted) return "rendered";
  if (o.tool === "failed") return "tool-failed";
  if (o.access === "not-shared") return "not-shared";
  if (o.access === "unknown") return "cant-tell";
  if (o.tool === "timeout") return "tool-timeout";
  return "opening";
}

function open(o: OpenData): OpenState {
  return { ...o, kind: kindOf(o) } as OpenState;
}

function fromResolution(r: Resolution, view: number): State {
  if (r.kind === "no-tool") {
    return {
      kind: "no-tool",
      type: r.type,
      suggestion: r.suggestion,
      anything: r.anything,
    };
  }
  return open({
    toolId: r.toolId,
    // nothing to load for a doc with no datatype, or when it's the view's job
    tool: r.toolId ? "loading" : "loaded",
    error: undefined,
    attempt: 0,
    access: "unchecked",
    accessSeq: 0,
    mounted: false,
    view,
  });
}

function sameAnything(
  a: { id: string; name: string } | undefined,
  b: { id: string; name: string } | undefined
) {
  return a?.id === b?.id && a?.name === b?.name;
}

function resolved(state: State, r: Resolution): State {
  if (r.kind === "no-tool") {
    if (
      state.kind === "no-tool" &&
      state.type === r.type &&
      state.suggestion === r.suggestion &&
      sameAnything(state.anything, r.anything)
    )
      return state;
    return fromResolution(r, 0);
  }
  if (isOpen(state)) {
    if (state.toolId === r.toolId) return state;
    // the tool changed: patchwork-view follows tool-id by itself
    return open({
      ...state,
      toolId: r.toolId,
      tool: r.toolId ? "loading" : "loaded",
      error: undefined,
      attempt: state.attempt + 1,
    });
  }
  if (state.kind === "no-tool") return fromResolution(r, 0);
  return state;
}

/** The next state; the same object when the event doesn't apply. */
export function step(state: State, event: Event): State {
  switch (event.type) {
    case "repo-ready":
      return state.kind === "waiting-repo"
        ? { kind: "finding", epoch: 1 }
        : state;

    case "no-provider":
      return state.kind === "waiting-repo" ? { kind: "bare" } : state;

    case "look":
      if (state.kind === "finding" || state.kind === "unavailable")
        return { ...state, epoch: state.epoch + 1 };
      return state;

    case "found":
      if (state.kind === "finding" && state.epoch === event.epoch)
        return fromResolution(event.resolution, 0);
      if (state.kind === "unavailable" && state.epoch === event.epoch)
        // patchwork-view gave up on a doc it couldn't get, and won't look
        // again by itself: a new one gets a fresh start
        return fromResolution(event.resolution, state.view + 1);
      return state;

    case "missed":
      if (state.kind === "finding" && state.epoch === event.epoch)
        return {
          kind: "unavailable",
          epoch: state.epoch,
          misses: 1,
          view: 0,
        };
      if (state.kind === "unavailable" && state.epoch === event.epoch)
        return { ...state, misses: state.misses + 1 };
      return state;

    case "invalid":
      if (
        (state.kind === "finding" || state.kind === "unavailable") &&
        state.epoch === event.epoch
      )
        return { kind: "invalid" };
      return state;

    case "deleted":
      if (state.kind === "finding" || state.kind === "unavailable")
        return event.epoch === state.epoch ? { kind: "deleted" } : state;
      // from the handle's own word, once the doc was found
      if (event.epoch === undefined && (state.kind === "no-tool" || isOpen(state)))
        return { kind: "deleted" };
      return state;

    case "resolved":
      return resolved(state, event.resolution);

    case "mounted":
      if (isOpen(state)) {
        return state.mounted ? state : open({ ...state, mounted: true });
      }
      // it got the doc we couldn't (a keyhive sync can grant access)
      if (state.kind === "unavailable")
        return open({
          toolId: undefined,
          tool: "loaded",
          error: undefined,
          attempt: 0,
          access: "unchecked",
          accessSeq: 0,
          mounted: true,
          view: state.view,
        });
      return state;

    case "tool-loaded":
      if (isOpen(state) && isCurrentLoad(state, event)) {
        return open({ ...state, tool: "loaded", error: undefined });
      }
      return state;

    case "tool-failed":
      if (isOpen(state) && isCurrentLoad(state, event))
        return open({ ...state, tool: "failed", error: event.message });
      return state;

    case "tool-timeout":
      // only a load still going can time out
      if (isOpen(state) && isCurrentLoad(state, event) && state.tool === "loading")
        return open({ ...state, tool: "timeout" });
      return state;

    case "retry-tool":
      if (isOpen(state) && (state.tool === "failed" || state.tool === "timeout"))
        return open({
          ...state,
          tool: "loading",
          error: undefined,
          attempt: state.attempt + 1,
        });
      return state;

    case "access":
      if (isOpen(state) && event.seq > state.accessSeq)
        return open({ ...state, access: event.result, accessSeq: event.seq });
      return state;
  }
}

// a load result counts while it's for the tool and try we're on. a result
// for the same try may also land after a timeout: a slow tool is still a tool
function isCurrentLoad(
  state: OpenData,
  event: { toolId: string; attempt: number }
): boolean {
  return (
    state.toolId === event.toolId &&
    state.attempt === event.attempt &&
    (state.tool === "loading" || state.tool === "timeout")
  );
}
