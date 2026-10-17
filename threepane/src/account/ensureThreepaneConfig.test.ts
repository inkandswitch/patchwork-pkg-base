import { describe, expect, it, vi } from "vitest";
import { ensureThreepaneConfig } from "./ensureThreepaneConfig";
import { uniqueSlots } from "../components/SlotView";

vi.mock("@inkandswitch/patchwork-plugins", () => ({
  createDocOfDatatype2: vi.fn(),
  getRegistry: vi.fn(),
}));

describe("tray slots", () => {
  it("keeps the first slot for each tool, including tuple slots", () => {
    const slots = ["theme-tray", "llm-config-tray", ["llm-config-tray", "doc"], "other", "llm-config-tray"] as any;
    expect(uniqueSlots(slots)).toEqual(["theme-tray", "llm-config-tray", "other"]);
  });

  it("cleans up saved duplicates and does not add another model button on reload", async () => {
    const config = {
      sidebar: { widgets: [] },
      doctitle: { tools: ["doc-openwith"] },
      tray: ["theme-tray", "llm-config-tray", "llm-config-tray"],
    };
    const configHandle = { change: vi.fn((fn: (doc: typeof config) => void) => fn(config)) };
    const accountHandle = { doc: () => ({ tools: { threepane: "config" } }) };
    const repo = { find: vi.fn(async () => configHandle) };

    await ensureThreepaneConfig(accountHandle as any, repo as any);
    await ensureThreepaneConfig(accountHandle as any, repo as any);

    expect(config.tray).toEqual(["theme-tray", "llm-config-tray"]);
  });
});
