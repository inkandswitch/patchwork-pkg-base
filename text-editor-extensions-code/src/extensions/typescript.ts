import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { FLAVOURS, TSX, type Flavour } from "../flavours.ts";

// A document with no filename -- a plain `text` doc that opted into this plugin
// -- gets the most permissive parse, which is a superset of the rest.
function flavourFor(name: string | undefined): Flavour {
  if (!name) return TSX;
  const ext = name.split(".").pop()?.toLowerCase();
  return (ext && FLAVOURS[ext]) || TSX;
}

/**
 * TypeScript language features: completions, hovers, inline diagnostics.
 *
 * Brings the grammar with it -- the language service and the parser have to
 * agree about whether they're reading .ts or .tsx, so one plugin decides for
 * both. Don't pair it with `js`/`jsx`/`ts`/`tsx`; two language extensions in one
 * editor is one too many.
 *
 * A factory rather than a plain extension because it has to know how to parse
 * the document before it can start -- see `DocumentContext` in the text-editor
 * package. The environment (and the TypeScript compiler it needs) is imported
 * dynamically and reconfigured in once it's ready, so the editor is usable
 * immediately and a failure here just leaves a plain editor.
 */
export function typescript(context: { name?: string }): Extension {
  const flavour = flavourFor(context.name);
  const path = flavour.path;
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
          ] = await Promise.all([
            import("../ts-env.ts"),
            import("@valtown/codemirror-ts"),
          ]);
          const env = await createTsEnv(path, view.state.doc.toString());
          if (this.disposed) return;
          view.dispatch({
            effects: lsp.reconfigure([
              tsFacet.of({ env, path }),
              tsSync(),
              tsLinter(),
              // A completion SOURCE only. The editor already installed
              // `autocompletion()`, and a second one would be a second copy of
              // the extension -- this bundle's, not the editor's -- so the two
              // would each show their own tooltip and fight over the keymap.
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

  return [
    javascript({ jsx: flavour.jsx, typescript: flavour.typescript }),
    lsp.of([]),
    loader,
  ];
}
