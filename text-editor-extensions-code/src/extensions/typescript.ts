import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

// Which extensions get TypeScript language features, mapped to the virtual file
// path handed to the environment. The path's final extension is how TypeScript
// decides to parse the file, so .mts/.cts collapse to .ts and .mjs/.cjs to .js.
const PATHS: Record<string, string> = {
  js: "/index.js",
  mjs: "/index.js",
  cjs: "/index.js",
  jsx: "/index.jsx",
  ts: "/index.ts",
  mts: "/index.ts",
  cts: "/index.ts",
  tsx: "/index.tsx",
};

// A document with no filename -- a plain `text` doc that opted into this plugin
// -- gets the most permissive parse, which is a superset of the rest.
const DEFAULT_PATH = "/index.tsx";

function virtualPath(name: string | undefined): string {
  if (!name) return DEFAULT_PATH;
  const ext = name.split(".").pop()?.toLowerCase();
  return (ext && PATHS[ext]) || DEFAULT_PATH;
}

/**
 * TypeScript language features: completions, hovers, inline diagnostics.
 *
 * A factory rather than a plain extension because it has to know how to parse
 * the document before it can start -- see `DocumentContext` in the text-editor
 * package. The environment (and the TypeScript compiler it needs) is imported
 * dynamically and reconfigured in once it's ready, so the editor is usable
 * immediately and a failure here just leaves a plain editor.
 */
export function typescript(context: { name?: string }): Extension {
  const path = virtualPath(context.name);
  const lsp = new Compartment();

  const loader = ViewPlugin.fromClass(
    class {
      disposed = false;

      constructor(view: EditorView) {
        void this.start(view);
      }

      async start(view: EditorView) {
        try {
          const [
            { createTsEnv },
            { tsFacet, tsSync, tsLinter, tsAutocomplete, tsHover },
            { autocompletion },
          ] = await Promise.all([
            import("../ts-env.ts"),
            import("@valtown/codemirror-ts"),
            import("@codemirror/autocomplete"),
          ]);
          const env = await createTsEnv(path, view.state.doc.toString());
          if (this.disposed) return;
          view.dispatch({
            effects: lsp.reconfigure([
              tsFacet.of({ env, path }),
              tsSync(),
              tsLinter(),
              autocompletion(),
              // Through languageData rather than `override`: `override` would
              // replace every other completion source in the editor, including
              // the base editor's `/` menu.
              EditorState.languageData.of(() => [
                { autocomplete: tsAutocomplete() },
              ]),
              tsHover(),
            ]),
          });
        } catch (error) {
          // LSP is an enhancement -- a failure here (e.g. offline with no
          // cached lib.d.ts) leaves a perfectly usable plain editor.
          console.error("failed to start TypeScript LSP", error);
        }
      }

      destroy() {
        this.disposed = true;
      }
    }
  );

  return [lsp.of([]), loader];
}
