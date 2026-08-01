import { type DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

export type TextDoc = {
  content: string;
  plugins: string[];
  title?: string;
};

// Plain text: a `content` string and no editor plugins. Everything beyond a
// bare editor -- markdown, syntax highlighting, links -- is opted into by
// putting a `codemirror:extension` id in `plugins`.
export const TextDatatype: DatatypeImplementation<TextDoc> = {
  init(doc: TextDoc) {
    doc.content = "";
    doc.plugins = [];
  },
  getTitle(doc: TextDoc) {
    if (doc.title) return doc.title;
    const line = doc.content?.split("\n").find((l) => l.trim() !== "");
    return line?.trim().slice(0, 100) || "Untitled";
  },
  setTitle(doc: TextDoc, title: string) {
    doc.title = title;
  },
};
