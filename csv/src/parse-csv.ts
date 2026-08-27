// An offset-tracking CSV parser: every cell carries the [start, end) character
// range it occupies in the source text (quotes included). Those offsets are
// what connect cells to Patchwork's cursor-anchored provenance refs, which
// address character ranges of the file doc's `content` string.

export type CsvCell = {
  /** The cell's decoded value (quotes stripped, "" unescaped). */
  value: string;
  /** Character offset of the cell's first char in the source (inclusive). */
  start: number;
  /** Character offset just past the cell's last char (exclusive). */
  end: number;
};

/**
 * RFC-4180-flavoured: cells separated by `delimiter`, rows by \n or \r\n,
 * quoted cells may contain delimiters/newlines and escape quotes by doubling.
 * An unterminated quote runs to the end of input. A trailing newline does not
 * produce an empty final row.
 */
export function parseCsv(text: string, delimiter = ","): CsvCell[][] {
  if (text.length === 0) return [];
  const rows: CsvCell[][] = [];
  let row: CsvCell[] = [];
  let i = 0;

  for (;;) {
    const start = i;
    let value = "";

    if (text[i] === '"') {
      i++;
      for (;;) {
        if (i >= text.length) break;
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            value += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          value += text[i];
          i++;
        }
      }
    } else {
      while (
        i < text.length &&
        text[i] !== delimiter &&
        text[i] !== "\n" &&
        text[i] !== "\r"
      ) {
        value += text[i];
        i++;
      }
    }
    row.push({ value, start, end: i });

    if (i >= text.length) {
      rows.push(row);
      break;
    }
    if (text[i] === delimiter) {
      i++;
      continue;
    }
    // Row terminator.
    if (text[i] === "\r" && text[i + 1] === "\n") i += 2;
    else i++;
    rows.push(row);
    row = [];
    if (i >= text.length) break;
  }
  return rows;
}

/** The delimiter a file most likely uses, from its name/extension/content. */
export function sniffDelimiter(
  extension: string | undefined,
  firstLine: string,
): string {
  if (extension?.toLowerCase() === "tsv") return "\t";
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return tabs > commas ? "\t" : ",";
}

/** Whether a file doc looks like CSV/TSV (by name, mime type or extension). */
export function looksLikeCsv(meta: {
  name?: string;
  extension?: string;
  mimeType?: string;
}): boolean {
  const ext = (meta.extension || meta.name?.split(".").pop() || "")
    .toLowerCase()
    .trim();
  if (ext === "csv" || ext === "tsv") return true;
  const mime = (meta.mimeType || "").toLowerCase();
  return mime.includes("csv") || mime.includes("tab-separated");
}
