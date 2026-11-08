import { describe, expect, it } from "vitest";
import {
  initial,
  isOpen,
  step,
  viewOf,
  type Event,
  type Resolution,
  type State,
} from "./main-doc-machine";

const open = (toolId: string | undefined = "t"): Resolution => ({
  kind: "open",
  toolId,
});
const noTool: Resolution = {
  kind: "no-tool",
  type: "thing",
  suggestion: undefined,
  anything: undefined,
};

const run = (from: State, ...events: Event[]) => events.reduce(step, from);
const finding = (): State => run(initial, { type: "repo-ready" });
const unavailable = (): State => run(finding(), { type: "missed", epoch: 1 });
const opening = (toolId = "t"): State =>
  run(finding(), { type: "found", epoch: 1, resolution: open(toolId) });

describe("the repo", () => {
  it("waits for it, then finds", () => {
    expect(initial.kind).toBe("waiting-repo");
    expect(step(initial, { type: "repo-ready" })).toEqual({ kind: "finding", epoch: 1 });
  });
  it("a late repo is the same as an early one", () => {
    const s = run(initial, { type: "look" }, { type: "mounted" });
    expect(s).toBe(initial);
    expect(step(s, { type: "repo-ready" }).kind).toBe("finding");
  });
  it("no provider at all is its own state, not a wait", () => {
    expect(step(initial, { type: "no-provider" }).kind).toBe("bare");
  });
  it("a repo arriving twice changes nothing", () => {
    const s = finding();
    expect(step(s, { type: "repo-ready" })).toBe(s);
  });
  it("does not look or hear about docs before it has a repo", () => {
    for (const e of [
      { type: "found", epoch: 1, resolution: open() },
      { type: "missed", epoch: 1 },
      { type: "invalid", epoch: 1 },
      { type: "deleted" },
    ] as Event[])
      expect(step(initial, e)).toBe(initial);
  });
});

describe("finding", () => {
  it("finds a doc with a tool", () => {
    const s = opening();
    expect(s).toMatchObject({ kind: "opening", toolId: "t", tool: "loading", view: 0 });
  });
  it("finds a doc with no tool", () => {
    expect(run(finding(), { type: "found", epoch: 1, resolution: noTool }).kind).toBe("no-tool");
  });
  it("finds a doc with no datatype and leaves it to patchwork-view", () => {
    const s = run(finding(), { type: "found", epoch: 1, resolution: { kind: "open", toolId: undefined } });
    expect(s).toMatchObject({ kind: "opening", tool: "loaded" });
  });
  it("misses into unavailable", () => {
    expect(unavailable()).toMatchObject({ kind: "unavailable", epoch: 1, misses: 1 });
  });
  it("an invalid url is invalid", () => {
    expect(run(finding(), { type: "invalid", epoch: 1 }).kind).toBe("invalid");
  });
  it("a deleted doc is deleted", () => {
    expect(run(finding(), { type: "deleted", epoch: 1 }).kind).toBe("deleted");
  });
  it("looking again starts a new epoch", () => {
    expect(run(finding(), { type: "look" })).toEqual({ kind: "finding", epoch: 2 });
  });
  it("ignores the handle's delete before it has found anything", () => {
    const s = finding();
    expect(step(s, { type: "deleted" })).toBe(s);
  });
});

describe("overlapping finds", () => {
  it("an older rejection after a newer success does not undo it", () => {
    const s = run(
      unavailable(),
      { type: "look" }, // epoch 2
      { type: "found", epoch: 2, resolution: open() }
    );
    expect(s.kind).toBe("opening");
    expect(step(s, { type: "missed", epoch: 1 })).toBe(s);
    expect(step(s, { type: "missed", epoch: 2 })).toBe(s);
  });
  it("an older rejection while a newer find is out is dropped", () => {
    const s = run(unavailable(), { type: "look" });
    expect(step(s, { type: "missed", epoch: 1 })).toBe(s);
  });
  it("an older success while a newer find is out is dropped", () => {
    const s = run(unavailable(), { type: "look" });
    expect(step(s, { type: "found", epoch: 1, resolution: open() })).toBe(s);
  });
  it("an older invalid or deleted is dropped too", () => {
    const s = run(unavailable(), { type: "look" });
    expect(step(s, { type: "invalid", epoch: 1 })).toBe(s);
    expect(step(s, { type: "deleted", epoch: 1 })).toBe(s);
  });
  it("a success arriving after the doc is already open is dropped", () => {
    const s = opening();
    expect(step(s, { type: "found", epoch: 1, resolution: noTool })).toBe(s);
  });
});

describe("unavailable", () => {
  it("counts misses for the backoff", () => {
    expect(run(unavailable(), { type: "missed", epoch: 1 })).toMatchObject({ misses: 2 });
  });
  it("looking again keeps the card and bumps the epoch", () => {
    expect(run(unavailable(), { type: "look" })).toMatchObject({
      kind: "unavailable",
      epoch: 2,
      misses: 1,
    });
  });
  it("found after unavailable restarts patchwork-view", () => {
    const u = unavailable();
    expect(viewOf(u)).toBe(0);
    const s = run(u, { type: "found", epoch: 1, resolution: open() });
    expect(viewOf(s)).toBe(1);
  });
  it("patchwork-view mounting first becomes rendered, with no impossible leftovers", () => {
    const s = run(unavailable(), { type: "mounted" });
    expect(s.kind).toBe("rendered");
    expect(viewOf(s)).toBe(0);
  });
  it("can turn invalid or deleted", () => {
    expect(run(unavailable(), { type: "invalid", epoch: 1 }).kind).toBe("invalid");
    expect(run(unavailable(), { type: "deleted", epoch: 1 }).kind).toBe("deleted");
  });
});

describe("deleted", () => {
  it("the handle deleting an open doc is deleted", () => {
    expect(run(opening(), { type: "deleted" }).kind).toBe("deleted");
  });
  it("the handle deleting a doc with no tool is deleted", () => {
    const s = run(finding(), { type: "found", epoch: 1, resolution: noTool }, { type: "deleted" });
    expect(s.kind).toBe("deleted");
  });
  it("a stale find's deleted does not delete an open doc", () => {
    const s = opening();
    expect(step(s, { type: "deleted", epoch: 1 })).toBe(s);
  });
  it("stays deleted", () => {
    const s: State = { kind: "deleted" };
    expect(step(s, { type: "mounted" })).toBe(s);
    expect(step(s, { type: "resolved", resolution: open() })).toBe(s);
  });
});

describe("no tool", () => {
  const none = () => run(finding(), { type: "found", epoch: 1, resolution: noTool });
  it("a tool arriving opens it", () => {
    expect(run(none(), { type: "resolved", resolution: open() }).kind).toBe("opening");
  });
  it("the same answer again is the same state", () => {
    const s = none();
    expect(step(s, { type: "resolved", resolution: { ...noTool } })).toBe(s);
  });
  it("a different offer is a new state", () => {
    const s = none();
    const next = step(s, {
      type: "resolved",
      resolution: { ...noTool, anything: { id: "raw", name: "Raw" } },
    });
    expect(next).not.toBe(s);
    expect(next.kind).toBe("no-tool");
  });
  it("ignores tool and access events", () => {
    const s = none();
    expect(step(s, { type: "tool-loaded", toolId: "t", attempt: 0 })).toBe(s);
    expect(step(s, { type: "access", seq: 1, result: "not-shared" })).toBe(s);
    expect(step(s, { type: "mounted" })).toBe(s);
  });
});

describe("opening a tool", () => {
  it("mounting renders", () => {
    expect(run(opening(), { type: "mounted" }).kind).toBe("rendered");
  });
  it("loading settles without changing the card", () => {
    const s = run(opening(), { type: "tool-loaded", toolId: "t", attempt: 0 });
    expect(s).toMatchObject({ kind: "opening", tool: "loaded" });
  });
  it("a failed load is tool-failed with the message", () => {
    const s = run(opening(), { type: "tool-failed", toolId: "t", attempt: 0, message: "boom" });
    expect(s).toMatchObject({ kind: "tool-failed", error: "boom" });
  });
  it("retrying goes back to loading on a new attempt", () => {
    const s = run(
      opening(),
      { type: "tool-failed", toolId: "t", attempt: 0, message: "boom" },
      { type: "retry-tool" }
    );
    expect(s).toMatchObject({ kind: "opening", tool: "loading", attempt: 1, error: undefined });
  });
  it("retrying when nothing failed does nothing", () => {
    const s = opening();
    expect(step(s, { type: "retry-tool" })).toBe(s);
  });
  it("a result for another tool or an older attempt is dropped", () => {
    const retried = run(
      opening(),
      { type: "tool-failed", toolId: "t", attempt: 0, message: "boom" },
      { type: "retry-tool" }
    );
    expect(step(retried, { type: "tool-failed", toolId: "t", attempt: 0, message: "old" })).toBe(retried);
    expect(step(retried, { type: "tool-loaded", toolId: "other", attempt: 1 })).toBe(retried);
  });
  it("a tool changing restarts its load and keeps patchwork-view", () => {
    const s = opening("a");
    const next = step(s, { type: "resolved", resolution: open("b") });
    expect(next).toMatchObject({ kind: "opening", toolId: "b", tool: "loading", attempt: 1 });
    expect(viewOf(next)).toBe(viewOf(s));
  });
  it("the same tool resolved again is the same state", () => {
    const s = opening();
    expect(step(s, { type: "resolved", resolution: open() })).toBe(s);
  });
  it("its tool going away is no-tool", () => {
    expect(run(opening(), { type: "resolved", resolution: noTool }).kind).toBe("no-tool");
  });
});

describe("tool load timeout", () => {
  const timedOut = () => run(opening(), { type: "tool-timeout", toolId: "t", attempt: 0 });
  it("a load that never settles times out", () => {
    expect(timedOut()).toMatchObject({ kind: "tool-timeout", tool: "timeout" });
  });
  it("takes patchwork-view away, so there is no dot behind the card", () => {
    expect(viewOf(timedOut())).toBeUndefined();
  });
  it("a load that already settled can't time out", () => {
    const loaded = run(opening(), { type: "tool-loaded", toolId: "t", attempt: 0 });
    expect(step(loaded, { type: "tool-timeout", toolId: "t", attempt: 0 })).toBe(loaded);
  });
  it("a stale timeout is dropped", () => {
    const s = run(
      opening(),
      { type: "tool-failed", toolId: "t", attempt: 0, message: "x" },
      { type: "retry-tool" }
    );
    expect(step(s, { type: "tool-timeout", toolId: "t", attempt: 0 })).toBe(s);
  });
  it("a slow tool that does arrive recovers", () => {
    expect(run(timedOut(), { type: "tool-loaded", toolId: "t", attempt: 0 })).toMatchObject({
      kind: "opening",
      tool: "loaded",
    });
  });
  it("a slow tool that then fails says so", () => {
    expect(
      run(timedOut(), { type: "tool-failed", toolId: "t", attempt: 0, message: "x" }).kind
    ).toBe("tool-failed");
  });
  it("try again loads again", () => {
    expect(run(timedOut(), { type: "retry-tool" })).toMatchObject({
      kind: "opening",
      tool: "loading",
      attempt: 1,
    });
  });
  it("mounting anyway wins", () => {
    expect(run(timedOut(), { type: "mounted" }).kind).toBe("rendered");
  });
});

describe("access", () => {
  it("not shared shows the card, and sharing clears it", () => {
    const s = run(opening(), { type: "access", seq: 1, result: "not-shared" });
    expect(s.kind).toBe("not-shared");
    expect(viewOf(s)).toBeDefined();
    expect(run(s, { type: "access", seq: 2, result: "shared" }).kind).toBe("opening");
  });
  it("an older false after a newer true does not bring the card back", () => {
    const s = run(opening(), { type: "access", seq: 2, result: "shared" });
    expect(step(s, { type: "access", seq: 1, result: "not-shared" })).toBe(s);
  });
  it("an older true after a newer false does not hide the card", () => {
    const s = run(opening(), { type: "access", seq: 2, result: "not-shared" });
    expect(step(s, { type: "access", seq: 1, result: "shared" })).toBe(s);
  });
  it("an error is can't-tell, not shared", () => {
    expect(run(opening(), { type: "access", seq: 1, result: "unknown" }).kind).toBe("cant-tell");
  });
  it("can't-tell clears when a later check answers", () => {
    const s = run(
      opening(),
      { type: "access", seq: 1, result: "unknown" },
      { type: "access", seq: 2, result: "shared" }
    );
    expect(s.kind).toBe("opening");
  });
  it("a tool failing and no access never show together: one kind", () => {
    const s = run(
      opening(),
      { type: "access", seq: 1, result: "not-shared" },
      { type: "tool-failed", toolId: "t", attempt: 0, message: "x" }
    );
    expect(s.kind).toBe("tool-failed");
    expect(isOpen(s) && s.access).toBe("not-shared");
    // and once the tool is back, the access card is still owed
    expect(run(s, { type: "retry-tool" }).kind).toBe("not-shared");
  });
  it("a tool rendering beats a stale not-shared", () => {
    const s = run(
      opening(),
      { type: "access", seq: 1, result: "not-shared" },
      { type: "mounted" }
    );
    expect(s.kind).toBe("rendered");
  });
  it("access answers before a doc is found are dropped", () => {
    const s = finding();
    expect(step(s, { type: "access", seq: 1, result: "shared" })).toBe(s);
  });
});

describe("selecting while loading", () => {
  it("is a new machine: events for the old one's finds land on nothing", () => {
    // the component is keyed on the selection, so a new doc starts at initial
    // and a late reply from the old one's epoch 1 can't be mistaken
    const fresh = run(initial, { type: "repo-ready" });
    expect(fresh).toEqual({ kind: "finding", epoch: 1 });
  });
});

describe("step", () => {
  it("is pure: the input state is never changed", () => {
    const s = opening();
    const copy = JSON.parse(JSON.stringify(s));
    step(s, { type: "mounted" });
    step(s, { type: "access", seq: 1, result: "unknown" });
    expect(JSON.parse(JSON.stringify(s))).toEqual(copy);
  });
  it("every kind is reachable from events", () => {
    const kinds = new Set<string>();
    const seen = (s: State) => kinds.add(s.kind);
    seen(initial);
    seen(step(initial, { type: "no-provider" }));
    seen(finding());
    seen(unavailable());
    seen(run(finding(), { type: "invalid", epoch: 1 }));
    seen(run(finding(), { type: "deleted", epoch: 1 }));
    seen(run(finding(), { type: "found", epoch: 1, resolution: noTool }));
    const o = opening();
    seen(o);
    seen(run(o, { type: "mounted" }));
    seen(run(o, { type: "tool-failed", toolId: "t", attempt: 0, message: "" }));
    seen(run(o, { type: "tool-timeout", toolId: "t", attempt: 0 }));
    seen(run(o, { type: "access", seq: 1, result: "not-shared" }));
    seen(run(o, { type: "access", seq: 1, result: "unknown" }));
    expect([...kinds].sort()).toEqual(
      [
        "bare", "cant-tell", "deleted", "finding", "invalid", "no-tool", "not-shared",
        "opening", "rendered", "tool-failed", "tool-timeout", "unavailable", "waiting-repo",
      ].sort()
    );
  });
});
