import { describe, expect, it, vi } from "vitest";

// The host's registries, as this tool finds them: set per test.
const host = vi.hoisted(() => ({
  registries: new Map<string, unknown>(),
  unregisterPlugins: vi.fn(),
}));
vi.mock("@inkandswitch/patchwork-plugins", () => ({
  getAllRegistries: () => host.registries,
  unregisterPlugins: host.unregisterPlugins,
}));

import {
  deactivateModule,
  hostKeepsShadows,
  readRegistrySnapshot,
} from "./registry.ts";
import {
  countOrigins,
  filterEntries,
  groupByType,
  type Enriched,
} from "./model.ts";

const DOC = "automerge:2uZrhZ7G2NJxryZSMWSdDNFCke8C";
const DEV = "https://dev.example.test/tool/index.js";
const tool = (id: string, importUrl: string) => ({
  type: "patchwork:tool",
  id,
  name: id,
  importUrl,
});

// a registry from before shadows: only what's in use
function oldRegistry(plugins: any[]) {
  return { all: () => plugins, remove: vi.fn(() => true) };
}
// one that keeps them: each id's registrations, the one in use first
function shadowingRegistry(registrations: any[][]) {
  return {
    all: () => registrations.map((r) => r[0]),
    shadows: (id: string) =>
      registrations.find((r) => r[0].id === id)?.slice(1) ?? [],
    remove: vi.fn(() => true),
  };
}

describe("reading the registries", () => {
  it("reads every plugin as in use from a host without shadows", () => {
    const registries = new Map([
      ["patchwork:tool", oldRegistry([tool("a", DOC)])],
    ]);
    expect(hostKeepsShadows(registries)).toBe(false);
    expect(readRegistrySnapshot(registries)).toEqual([
      expect.objectContaining({ id: "a", importUrl: DOC, inUse: true }),
    ]);
    expect(readRegistrySnapshot(registries)[0].shadows).toBeUndefined();
  });

  it("reads shadowed registrations from a host with shadows", () => {
    const registries = new Map([
      [
        "patchwork:tool",
        shadowingRegistry([[tool("a", DEV), tool("a", DOC)], [tool("b", DOC)]]),
      ],
    ]);
    expect(hostKeepsShadows(registries)).toBe(true);
    const [top, under, alone] = readRegistrySnapshot(registries);
    expect(top).toMatchObject({
      id: "a",
      importUrl: DEV,
      inUse: true,
      shadows: [DOC],
    });
    expect(under).toMatchObject({
      id: "a",
      importUrl: DOC,
      inUse: false,
      shadowedBy: DEV,
    });
    expect(alone).toMatchObject({ id: "b", inUse: true });
    expect(alone.shadows).toBeUndefined();
  });
});

describe("uninstalling", () => {
  it("unregisters the package where the host keeps shadows", () => {
    const registry = shadowingRegistry([[tool("a", DEV), tool("a", DOC)]]);
    host.registries = new Map([["patchwork:tool", registry]]);
    host.unregisterPlugins.mockClear();

    deactivateModule(`${DOC}#heads`);

    expect(host.unregisterPlugins).toHaveBeenCalledWith(`${DOC}#heads`);
    expect(registry.remove).not.toHaveBeenCalled();
  });

  it("removes its plugins by id on an older host", () => {
    const registry = oldRegistry([tool("a", DOC), tool("b", DEV)]);
    host.registries = new Map([["patchwork:tool", registry]]);
    host.unregisterPlugins.mockClear();

    deactivateModule(DOC);

    expect(registry.remove).toHaveBeenCalledWith("a");
    expect(registry.remove).toHaveBeenCalledTimes(1);
    expect(host.unregisterPlugins).not.toHaveBeenCalled();
  });
});

describe("shadowed entries in the views", () => {
  const entry = (over: Partial<Enriched>): Enriched => ({
    registry: "patchwork:tool",
    id: "a",
    type: "patchwork:tool",
    name: "a",
    inUse: true,
    origin: "installed",
    pkgName: "pkg",
    ...over,
  });
  const top = entry({ origin: "core", shadows: [DOC], shadowsNames: ["mine"] });
  const under = entry({ inUse: false, shadowedBy: DEV, shadowedByName: "dev" });

  it("counts only the plugins in use", () => {
    expect(countOrigins([top, under])).toMatchObject({ core: 1, installed: 0 });
  });

  it("lists one plugin per id by type", () => {
    expect(groupByType([top, under])[0].plugins).toEqual([top]);
  });

  it("finds them by 'shadowed' and 'overrides'", () => {
    expect(filterEntries([top, under], "shadowed", "all")).toEqual([under]);
    expect(filterEntries([top, under], "overrides", "all")).toEqual([top]);
  });
});
