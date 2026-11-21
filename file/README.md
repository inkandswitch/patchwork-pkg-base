# File Plugin for Patchwork

A Solid.js-based plugin for viewing and editing various file types in Patchwork.

## Features

- **Text File Editing**: Full-featured text editor with syntax support
- **Image Viewing**: Display images (PNG, JPG, GIF, SVG, WebP, BMP)
- **PDF Viewing**: Embedded PDF viewer
- **HTML Viewing**: Sandboxed HTML preview
- **Long Text Support**: Read-only mode for very large text files (>100KB)

## Tech Stack

- **Solid.js** - Reactive UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Automerge** - CRDT for document synchronization

## Getting Started

### Install Dependencies

```bash
pnpm install
```

### Development

Build the plugin in watch mode:

```bash
pnpm dev
```

### Build

Build the plugin for production:

```bash
pnpm build
```

### Deploy

Build and sync to Patchwork:

```bash
pnpm push
```

## Adding CodeMirror extensions from outside

A tool that shows a text file with `<patchwork-view tool-id="file">` can add
its own CodeMirror extensions to the editor. Just before the editor is
created, the file tool dispatches a bubbling `file:codemirror-extensions`
event from inside the patchwork-view; push extensions onto
`event.detail.extensions`. It also carries `handle`, `doc`, and `readOnly`
(true for the read-only viewer used for ImmutableString and very long files):

```js
host.addEventListener("file:codemirror-extensions", (event) => {
	event.detail.extensions.push(myExtension)
})
```

The extensions must be built with the shared `@codemirror/*` modules from the
import map (the same ones the editor uses), not a bundled copy.

### The TypeScript language server

JavaScript and TypeScript files in the editor (not the read-only viewer) get
a TypeScript language server (tsgo, in a worker, shared by every editor on
the page). Each open file is `file:///<documentId>/index.<ext>` to it, and an
import of `automerge:<documentId>` (or `/automerge:<documentId>`) is that
document's `index.js`. For those files the event's detail has two more
fields; other files don't have them, so check before using them:

- `languageServer`: `writeFile(path, text)` and `removeFile(path)` put files
  of your own in the server's filesystem (paths from `/`), say the text of
  docs the code imports, or a `.d.ts` of types for it. The server is told as
  if a file watcher saw it, and the open files are checked again. Calls made
  before the server has started wait for it.
- `completionSources`: push CodeMirror completion sources onto it. They're
  asked first, and the server's options with a label one of them already gave
  at the same `from` are left out.

Cmd+click (ctrl+click off a Mac), or F12, goes to the definition of what's
under it. When that's in a file no editor on the page has open, the editor
dispatches a bubbling, composed `file:open-definition` event instead, with
`detail: {uri, line, character}` (the line and character are from 0):

```js
host.addEventListener("file:codemirror-extensions", (event) => {
	const {languageServer, completionSources} = event.detail
	languageServer?.writeFile("/lib/index.js", "export const width = 20")
	completionSources?.push(mySource)
})
host.addEventListener("file:open-definition", (event) => {
	const {uri, line, character} = event.detail
})
```

The cmd+click handler is a `mousedown` at default precedence, so one of
yours at `Prec.high` that returns true has the click first.

## Project Structure

```
file/
├── src/
│   ├── components/        # Solid.js components
│   │   ├── FileEditor.tsx       # Main editor component
│   │   ├── TextFileEditor.tsx   # Text editing
│   │   ├── ImageFileViewer.tsx  # Image display
│   │   ├── PDFFileViewer.tsx    # PDF display
│   │   ├── HTMLFileViewer.tsx   # HTML preview
│   │   └── ReadOnlyTextViewer.tsx # Read-only text viewer
│   ├── datatype.ts        # File datatype definition
│   ├── tool.tsx           # Plugin tool implementation
│   ├── types.ts           # TypeScript type definitions
│   ├── utils.ts           # Utility functions
│   ├── isBinaryFile.ts    # Binary file detection
│   └── index.ts           # Plugin entry point
├── dist/                  # Build output
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## File Types Supported

### Text Files
- Plain text files
- JSON
- JavaScript/TypeScript
- Python
- And more...

### Binary Files
- Images: PNG, JPG, GIF, SVG, WebP, BMP
- PDFs
- HTML files (rendered in iframe)

### Special Handling
- Large text files (>100KB) are displayed in read-only mode for performance
- Binary files are detected automatically using content analysis

## Plugin Definition

The plugin exports two main components:

1. **Datatype**: Defines how file documents are structured and managed
2. **Tool**: Provides the UI for viewing and editing files

## Notes

- This plugin uses a bundleless architecture but still requires a build step for TypeScript/Solid.js compilation
- No `@patchwork/*` dependencies - uses only standard Automerge and Solid.js
- Built to be lightweight and performant

## License

Copyright Ink & Switch