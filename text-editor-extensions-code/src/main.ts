// Code editing for the text editor, as `codemirror:extension` plugins.
//
// `code` is the editing surface -- gutters, folding, search, undo, keymaps --
// and knows no languages. Each language is its own plugin, so a document turns
// on exactly the grammar it needs:
//
//   plugins: ["code", "javascript"]
//
// Every language's grammar is behind its own `load()`, so opening a Python
// document never fetches the Rust one.

import type { Extension } from "@codemirror/state";

const language = (
  id: string,
  name: string,
  load: () => Promise<Extension>
) => ({ type: "codemirror:extension", id, name, load });

export const plugins = [
  {
    type: "codemirror:extension",
    id: "code",
    name: "Code Editing",
    async load(): Promise<Extension> {
      return (await import("./extensions/code.ts")).code();
    },
  },
  // JSX and TypeScript are always enabled: the parser handles plain JavaScript
  // fine either way, and one plugin beats four near-identical ones.
  language("javascript", "JavaScript", async () =>
    (await import("@codemirror/lang-javascript")).javascript({
      jsx: true,
      typescript: true,
    })
  ),
  language("css", "CSS", async () => (await import("@codemirror/lang-css")).css()),
  language("html", "HTML", async () =>
    (await import("@codemirror/lang-html")).html()
  ),
  language("json", "JSON", async () =>
    (await import("@codemirror/lang-json")).json()
  ),
  language("python", "Python", async () =>
    (await import("@codemirror/lang-python")).python()
  ),
  language("xml", "XML", async () => (await import("@codemirror/lang-xml")).xml()),
  language("yaml", "YAML", async () =>
    (await import("@codemirror/lang-yaml")).yaml()
  ),
  language("rust", "Rust", async () =>
    (await import("@codemirror/lang-rust")).rust()
  ),
  language("cpp", "C/C++", async () => (await import("@codemirror/lang-cpp")).cpp()),
  language("java", "Java", async () =>
    (await import("@codemirror/lang-java")).java()
  ),
  language("php", "PHP", async () => (await import("@codemirror/lang-php")).php()),
  language("sql", "SQL", async () => (await import("@codemirror/lang-sql")).sql()),
  language("wast", "WebAssembly Text", async () =>
    (await import("@codemirror/lang-wast")).wast()
  ),
  {
    // Unlike the others this resolves to a FACTORY, not an extension: it has to
    // know the document's filename to know how to parse it, so the editor calls
    // it with the document context. See `DocumentContext` in text-editor.
    type: "codemirror:extension",
    id: "typescript",
    name: "TypeScript Language Features",
    async load() {
      return (await import("./extensions/typescript.ts")).typescript;
    },
  },
];
