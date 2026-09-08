import { beforeEach, describe, expect, it, vi } from "vitest";

const { importModuleFromHttpUrl } = vi.hoisted(() => ({
  importModuleFromHttpUrl: vi.fn(),
}));

vi.mock("@inkandswitch/patchwork-filesystem", () => ({
  importModuleFromHttpUrl,
}));

import { discoverHttpPlugins } from "./discover-plugins.ts";

describe("discoverHttpPlugins", () => {
  beforeEach(() => {
    importModuleFromHttpUrl.mockReset();
  });

  it("imports HTTP packages through the host filesystem", async () => {
    importModuleFromHttpUrl.mockResolvedValue({
      plugins: [{ id: "example", load: () => {} }],
    });

    await expect(
      discoverHttpPlugins("https://example.com/package/")
    ).resolves.toEqual([{ id: "example" }]);
    expect(importModuleFromHttpUrl).toHaveBeenCalledWith(
      "https://example.com/package/"
    );
  });
});
