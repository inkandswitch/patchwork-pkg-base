import { describe, expect, it } from "vitest";
import { createRoot } from "solid-js";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import {
  canExpand,
  containerChildren,
  providerOf,
  useExpandable,
  type HostPaths,
  type Provider,
} from "./container.ts";

const A = "automerge:3tmVsDzywTYecevUsD21YABfXKon" as AutomergeUrl;
const B = "automerge:4MCbKQoMiEnGXchaHRH3e7kxWXVs" as AutomergeUrl;

const directory: Provider = {
  list: () => [
    { name: "dist/index.js", link: A },
    { name: "package.json", link: B },
    { name: "inline", value: { content: "x" } },
  ],
};
const board: Provider = {
  list: () => [
    { name: "child", link: A },
    { name: "notes", sub: ["notes"] },
  ],
};
const typeOf = (doc: any) => doc?.["@patchwork"]?.type;
const DIRECTORY = { "@patchwork": { type: "directory" } };
const BOARD = { "@patchwork": { type: "board" } };

/** patchwork-filesystem's built-ins, as an older host provides them. */
const builtIns: HostPaths = {
  providerFor: (doc) => (typeOf(doc) === "directory" ? directory : undefined),
};

/** A host with path-provider plugins, and a registry that can say one arrived. */
function withPlugins(types: string[] = ["board"]) {
  const listeners = new Set<() => void>();
  const supported = new Set(types);
  const host: HostPaths = {
    ...builtIns,
    pathProviderFor: async (doc) =>
      builtIns.providerFor!(doc) ?? (supported.has(typeOf(doc)) ? board : undefined),
    pathProviderTypes: () => new Set(supported),
    getRegistry: () => ({
      on: (_event, listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
  };
  const register = (type: string) => {
    supported.add(type);
    for (const listener of listeners) listener();
  };
  return { host, register, listeners };
}

describe("canExpand", () => {
  it("is true for directory and branches links when the host has providers", () => {
    expect(canExpand("directory", builtIns)).toBe(true);
    expect(canExpand("branches", builtIns)).toBe(true);
    expect(canExpand("markdown", builtIns)).toBe(false);
    expect(canExpand("folder", builtIns)).toBe(false); // folders have their own row
  });

  it("is false on a host without providers", () => {
    expect(canExpand("directory", {})).toBe(false);
  });

  it("is true for a type a path-provider plugin supports", () => {
    const { host } = withPlugins();
    expect(canExpand("board", host)).toBe(true);
    expect(canExpand("board", builtIns)).toBe(false);
  });
});

describe("useExpandable", () => {
  it("follows plugins as they register, and stops listening when disposed", () => {
    const { host, register, listeners } = withPlugins([]);
    createRoot((dispose) => {
      const expandable = useExpandable(host);
      expect(expandable("canvas")).toBe(false);
      register("canvas");
      expect(expandable("canvas")).toBe(true);
      dispose();
    });
    expect(listeners.size).toBe(0);
  });
});

describe("providerOf", () => {
  it("asks the host's plugins when it has them, else its built-ins", async () => {
    const { host } = withPlugins();
    expect(await providerOf(BOARD, host)).toBe(board);
    expect(await providerOf(DIRECTORY, host)).toBe(directory);
    expect(await providerOf(BOARD, builtIns)).toBeUndefined();
    expect(await providerOf(DIRECTORY, builtIns)).toBe(directory);
    expect(await providerOf(DIRECTORY, {})).toBeUndefined();
  });

  it("gives nothing when the host's lookup fails", async () => {
    const host: HostPaths = { pathProviderFor: () => Promise.reject(new Error("no")) };
    expect(await providerOf(BOARD, host)).toBeUndefined();
  });
});

describe("containerChildren", () => {
  it("lists the documents a container links to, by name, and hides plain values", () => {
    expect(containerChildren(DIRECTORY, directory)).toEqual([
      { name: "dist/index.js", url: A },
      { name: "package.json", url: B },
    ]);
  });

  it("lists sub-documents whose value is there, and hides those whose isn't", () => {
    const doc = { ...BOARD, notes: { content: "n" } };
    expect(containerChildren(doc, board)).toEqual([
      { name: "child", url: A },
      { name: "notes", sub: ["notes"] },
    ]);
    expect(containerChildren(BOARD, board)).toEqual([{ name: "child", url: A }]);
  });

  it("lists nothing without a provider, or when it throws", () => {
    expect(containerChildren(DIRECTORY, undefined)).toEqual([]);
    const broken: Provider = {
      list: () => {
        throw new Error("list");
      },
    };
    expect(containerChildren(BOARD, broken)).toEqual([]);
  });
});
