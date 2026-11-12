import { describe, expect, it, vi } from "vitest";
import {
  clampNumber,
  isValidKey,
  optionsOf,
  setValueAt,
  settingValue,
  settingsOf,
  valueAt,
} from "./schema";

describe("settingsOf", () => {
  it("keeps declared settings in order", () => {
    const plugin = {
      id: "t",
      properties: {
        b: { type: "boolean" },
        "font.size": { type: "number" },
        mode: { type: "enum", options: ["a"] },
      },
    };
    expect(settingsOf(plugin).map(([key]) => key)).toEqual(["b", "font.size", "mode"]);
  });

  it("leaves out what it can't draw, and keeps the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const plugin = {
      id: "t",
      properties: {
        ok: { type: "string" },
        weird: { type: "function" },
        "__proto__.x": { type: "string" },
        "bad key": { type: "string" },
        noOptions: { type: "enum" },
        notAnObject: 3,
      },
    };
    expect(settingsOf(plugin).map(([key]) => key)).toEqual(["ok"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("is empty for something that isn't a settings plugin", () => {
    expect(settingsOf(null)).toEqual([]);
    expect(settingsOf({ id: "x" })).toEqual([]);
    expect(settingsOf({ id: "x", properties: [] })).toEqual([]);
  });
});

describe("keys", () => {
  it("accepts dotted identifiers and refuses prototype paths", () => {
    expect(isValidKey("a")).toBe(true);
    expect(isValidKey("a.b-c.d_e")).toBe(true);
    expect(isValidKey("a..b")).toBe(false);
    expect(isValidKey("constructor.prototype")).toBe(false);
    expect(isValidKey("")).toBe(false);
  });
});

describe("values", () => {
  it("reads a dotted path", () => {
    expect(valueAt({ a: { b: 2 } }, "a.b")).toBe(2);
    expect(valueAt({ a: 1 }, "a.b")).toBeUndefined();
    expect(valueAt(undefined, "a")).toBeUndefined();
  });

  it("falls back to the default when nothing's chosen", () => {
    const setting = { type: "number" as const, default: 14 };
    expect(settingValue({}, "size", setting)).toBe(14);
    expect(settingValue({ size: 0 }, "size", setting)).toBe(0);
    expect(settingValue({ size: null }, "size", setting)).toBe(14);
  });

  it("writes a dotted path, making what's on the way", () => {
    const doc: Record<string, unknown> = {};
    setValueAt(doc, "font.size", 12);
    expect(doc).toEqual({ font: { size: 12 } });
  });

  it("takes a value out for undefined, and makes nothing to do it", () => {
    const doc: Record<string, unknown> = { font: { size: 12, family: "x" } };
    setValueAt(doc, "font.size", undefined);
    expect(doc).toEqual({ font: { family: "x" } });
    const empty: Record<string, unknown> = {};
    setValueAt(empty, "a.b", undefined);
    expect(empty).toEqual({});
  });

  it("won't write through a prototype path", () => {
    expect(() => setValueAt({}, "__proto__.polluted", 1)).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("helpers", () => {
  it("names enum options", () => {
    expect(
      optionsOf({ type: "enum", options: ["a", { value: "b", label: "Bee" }, { value: "c" }] }),
    ).toEqual([
      { value: "a", label: "a" },
      { value: "b", label: "Bee" },
      { value: "c", label: "c" },
    ]);
  });

  it("holds numbers to their bounds", () => {
    const setting = { type: "number" as const, min: 8, max: 32 };
    expect(clampNumber("4", setting)).toBe(8);
    expect(clampNumber("40", setting)).toBe(32);
    expect(clampNumber("12.5", setting)).toBe(12.5);
    expect(clampNumber("", setting)).toBeUndefined();
    expect(clampNumber("nope", setting)).toBeUndefined();
  });
});
