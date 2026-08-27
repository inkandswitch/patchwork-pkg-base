import { describe, expect, it } from "vitest";
import { parseCsv, sniffDelimiter, looksLikeCsv } from "./parse-csv";

const values = (text: string, delimiter?: string) =>
  parseCsv(text, delimiter).map((row) => row.map((c) => c.value));

describe("parseCsv", () => {
  it("parses plain rows", () => {
    expect(values("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("returns no rows for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("keeps empty cells", () => {
    expect(values("a,,c\n,,")).toEqual([
      ["a", "", "c"],
      ["", "", ""],
    ]);
  });

  it("parses a trailing empty cell", () => {
    expect(values("a,b,")).toEqual([["a", "b", ""]]);
  });

  it("ignores a trailing newline", () => {
    expect(values("a,b\n")).toEqual([["a", "b"]]);
  });

  it("handles CRLF line endings", () => {
    expect(values("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("decodes quoted cells with delimiters, newlines and escaped quotes", () => {
    expect(values('"a,b",plain\n"line\nbreak","say ""hi"""')).toEqual([
      ["a,b", "plain"],
      ["line\nbreak", 'say "hi"'],
    ]);
  });

  it("takes an unterminated quote to the end of input", () => {
    expect(values('a,"oops')).toEqual([["a", "oops"]]);
  });

  it("supports tab as delimiter", () => {
    expect(values("a\tb\nc\td", "\t")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("tracks each cell's exact source range", () => {
    const text = 'aa,"b,b"\ncc,dd';
    const rows = parseCsv(text);
    for (const row of rows) {
      for (const cell of row) {
        expect(text.slice(cell.start, cell.end)).toContain(
          cell.value.replace(/"/g, ""),
        );
      }
    }
    expect(rows[0][0]).toMatchObject({ start: 0, end: 2 });
    expect(rows[0][1]).toMatchObject({ start: 3, end: 8 }); // includes quotes
    expect(rows[1][0]).toMatchObject({ start: 9, end: 11 });
    expect(rows[1][1]).toMatchObject({ start: 12, end: 14 });
  });
});

describe("sniffDelimiter", () => {
  it("prefers the extension", () => {
    expect(sniffDelimiter("tsv", "a,b,c")).toBe("\t");
  });
  it("counts separators in the first line", () => {
    expect(sniffDelimiter(undefined, "a\tb\tc")).toBe("\t");
    expect(sniffDelimiter(undefined, "a,b,c")).toBe(",");
  });
});

describe("looksLikeCsv", () => {
  it("accepts csv/tsv extensions, names and mime types", () => {
    expect(looksLikeCsv({ extension: "csv" })).toBe(true);
    expect(looksLikeCsv({ name: "data.tsv" })).toBe(true);
    expect(looksLikeCsv({ mimeType: "text/csv" })).toBe(true);
    expect(looksLikeCsv({ name: "notes.md", mimeType: "text/markdown" })).toBe(
      false,
    );
  });
});
