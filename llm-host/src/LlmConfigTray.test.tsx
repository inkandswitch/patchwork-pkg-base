import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmConfigTray } from "./LlmConfigTray";

vi.mock("@chee/patchwork-llm", () => ({
  ensureConfig: vi.fn(async () => {}),
  dom: vi.fn(() => document.createElement("div")),
  readScopedConfig: vi.fn(),
  readConfig: vi.fn(),
  writeScopeOverride: vi.fn(),
  writeConfig: vi.fn(),
}));

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("model picker position", () => {
  it.each([
    [{ top: 50, bottom: 78, right: 300 }, "86px", "none"],
    [{ top: 650, bottom: 678, right: 300 }, "642px", "translateY(-100%)"],
  ])("keeps the picker in the viewport for button at %o", (rect, top, transform) => {
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(768);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1024);
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = LlmConfigTray(host, {} as Parameters<typeof LlmConfigTray>[1]);
    const button = host.querySelector("button")!;
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue(rect as DOMRect);

    button.click();
    const popover = document.querySelector<HTMLElement>(".llm-config-tray-popover")!;
    expect(popover.style.top).toBe(top);
    expect(popover.style.transform).toBe(transform);
    expect(parseFloat(popover.style.maxHeight)).toBeCloseTo(614.4);
    dispose();
  });
});

describe("model picker repo", () => {
  it("hands the repo it was rendered with to the library", async () => {
    const llm = await import("@chee/patchwork-llm");
    vi.mocked(llm.dom).mockClear();
    vi.mocked(llm.ensureConfig).mockClear();
    const repo = { id: "tray-repo" } as unknown as Parameters<typeof LlmConfigTray>[1];
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = LlmConfigTray(host, repo);

    host.querySelector("button")!.click();
    await vi.waitFor(() => expect(llm.dom).toHaveBeenCalled());
    expect(vi.mocked(llm.dom).mock.calls[0][0].repo).toBe(repo);
    expect(llm.ensureConfig).toHaveBeenCalledWith(undefined, host, repo);
    dispose();
  });
});
