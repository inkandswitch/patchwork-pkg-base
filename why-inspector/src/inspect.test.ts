import { describe as group, expect, it, beforeAll } from "vitest";
import { registerPlugins } from "@inkandswitch/patchwork-plugins";
import {
  describe,
  labelOf,
  noteMounted,
  shortHeads,
  shortUrl,
  viewsAround,
} from "./inspect.ts";
import { guessName } from "./package-name.ts";

beforeAll(() => {
  registerPlugins(
    [
      { type: "patchwork:tool", id: "test-list", name: "Document list", load: async () => () => () => {} },
      { type: "patchwork:component", id: "test-chrome", name: "Chrome", load: async () => () => () => {} },
    ] as any,
    "https://example.com/sideboard/dist/index.js"
  );
});

function view(attrs: Record<string, string>) {
  const el = document.createElement("patchwork-view");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

group("viewsAround", () => {
  it("lists the views around a node, outermost first, through shadow roots", () => {
    const outer = view({ component: "test-chrome" });
    const middle = view({ "tool-id": "test-list", "doc-url": "automerge:abc" });
    outer.append(middle);
    const shadow = middle.attachShadow({ mode: "open" });
    const inner = view({ "tool-id": "nope" });
    const leaf = document.createElement("span");
    inner.append(leaf);
    shadow.append(inner);
    document.body.append(outer);

    expect(viewsAround(leaf)).toEqual([outer, middle, inner]);
    outer.remove();
  });

  it("is empty when nothing around is a view", () => {
    expect(viewsAround(document.body)).toEqual([]);
  });
});

group("describe", () => {
  it("reads a tool with a tool-id, and finds who registered it", () => {
    const info = describe(view({ "tool-id": "test-list", "doc-url": "automerge:abc" }));
    expect(info).toMatchObject({
      kind: "tool",
      id: "test-list",
      toolSource: "asked",
      name: "Document list",
      importUrl: "https://example.com/sideboard/dist/index.js",
      docUrl: "automerge:abc",
    });
    expect(info.missing).toBeUndefined();
  });

  it("uses the tool it saw mount when there's no tool-id", () => {
    const el = view({ "doc-url": "automerge:abc" });
    noteMounted(el, "test-list");
    expect(describe(el)).toMatchObject({ id: "test-list", toolSource: "default" });
  });

  it("says it doesn't know when it never saw the view mount", () => {
    expect(describe(view({ "doc-url": "automerge:abc" }))).toMatchObject({
      id: undefined,
      toolSource: "unknown",
    });
  });

  it("says when a tool isn't installed", () => {
    expect(describe(view({ "tool-id": "not-here" }))).toMatchObject({ missing: true });
  });

  it("reads a component", () => {
    expect(describe(view({ component: "test-chrome" }))).toMatchObject({
      kind: "component",
      id: "test-chrome",
      name: "Chrome",
    });
  });

  it("reads what the isolation wall was handed, without looking inside", () => {
    const el = view({ component: "patchwork-isolation" });
    const script = document.createElement("script");
    script.type = "application/json";
    script.setAttribute("data-root-component-data", "");
    script.textContent = JSON.stringify({ selectedDocUrl: "automerge:xyz", selectedToolId: "test-list" });
    el.append(script);
    const info = describe(el);
    expect(info).toMatchObject({ kind: "isolated", id: "test-list", docUrl: "automerge:xyz", name: "Document list" });
    expect(labelOf(info)).toBe("isolated pane");
  });

  it("copes with broken isolation props", () => {
    const el = view({ component: "patchwork-isolation" });
    const script = document.createElement("script");
    script.setAttribute("data-root-component-data", "");
    script.textContent = "{nope";
    el.append(script);
    expect(describe(el)).toMatchObject({ kind: "isolated", toolSource: "unknown" });
  });
});

group("short forms", () => {
  it("shortens heads and urls", () => {
    expect(shortHeads(["abcdef0123456789", "1234567890"])).toBe("abcdef0 1234567");
    expect(shortHeads([])).toBe("(empty doc)");
    expect(shortUrl("automerge:4f2a9c8e7d6b5a")).toBe("automerge:4f2a9c…");
  });

  it("guesses a package name from its url", () => {
    expect(guessName("https://example.com/sideboard/dist/index.js")).toBe("sideboard");
    expect(guessName("automerge:4f2a9c8e7d6b5a")).toBe("automerge:4f2a9c…");
  });
});
