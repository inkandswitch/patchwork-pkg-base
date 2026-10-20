import { afterEach, describe, expect, it, vi } from "vitest";
import { CantMeasure, heaviest, measurePackage } from "./package-memory.ts";

const CHANNEL = "@patchwork/package-memory";

// Stands in for the automerge worker.
function worker(answer: (request: { id: string; url: string }, post: (m: unknown) => void) => void) {
  const channel = new BroadcastChannel(CHANNEL);
  channel.addEventListener("message", ({ data }) => {
    if (data?.type === "request") answer(data, (m) => channel.postMessage(m));
  });
  return channel;
}

describe("measurePackage", () => {
  const channels: BroadcastChannel[] = [];
  afterEach(() => {
    for (const c of channels.splice(0)) c.close();
    vi.useRealTimers();
  });

  it("resolves with the worker's reply", async () => {
    const documents = [
      { url: "automerge:a", path: "", ops: 10, changes: 2, largestChange: 6 },
      { url: "automerge:b", path: "index.js", ops: 900, changes: 1, largestChange: 900, content: { kind: "text", length: 890 } },
    ];
    channels.push(
      worker(({ id, url }, post) => {
        expect(url).toBe("automerge:pkg");
        post({ id, type: "accepted" });
        post({ id, type: "reply", documents });
      })
    );
    const result = await measurePackage("automerge:pkg");
    expect(result.documents).toEqual(documents);
    expect(heaviest(result.documents)?.path).toBe("index.js");
  });

  it("gives up if no worker says it heard", async () => {
    vi.useFakeTimers();
    const measuring = measurePackage("automerge:pkg");
    const caught = measuring.catch((e) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await caught).toBeInstanceOf(CantMeasure);
  });
});
