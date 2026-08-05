# Patchwork

## Reference tools in this repo

The skill's patterns map to these tools — copy from the category you need:

**Copy these patterns (vanilla JS — the house style):**

- **Bundleless / vanilla:** `tic-tac-toe`, `catclock`, `walkies`, `sparkles`, `webtile`
  (`tic-tac-toe/tic-tac-toe.js` also shows documenting the schema with a JSDoc `@typedef`)
- **Web Components + audio/wasm:** `bento`, `call`, `sound`
- **Headless actions:** `actions` (written in TypeScript)

**Reach for Solid if you need reactivity:** `cache-browser`, `file`, `chat`, `paper` (these use
JSX + a bundle; `solid-js/html` is a bundleless alternative).

**Legacy React — reference for behavior, NOT for style (don't copy the React approach):**
`datagrid`, `boardgame`, `datalog`, `doc-copy-history`.

- **Multi-plugin packages** (one package registering several plugins): `file/src/index.ts`
  (file + new-file datatypes), `bento/main.js` (datatype + tool)
- **Richer datatypes** (type guards, content getters): `file/src/datatype.ts`
- **Collaborative text** (`@automerge/automerge-codemirror` + cursors): `file`, `call`, `datalog`
- **CodeMirror extension:** `codemirror-latex`, `file`
- **Whole-folder / inspector (`supportedDatatypes: ["*"]`):** `inspector`, `cache-browser`,
  `breadboard`, `doc-copy-history`
