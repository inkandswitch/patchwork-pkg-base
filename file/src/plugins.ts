// A file usually doesn't store a plugin list -- its editor is derived from its
// name every time it's opened, so renaming a file changes how it's edited. A
// file that has been given its own `@text-editor.plugins` array keeps it, and
// the editor reads the document instead. These are `codemirror:extension` ids
// from text-editor-extensions-code (and -markdown), handed to the component.

const CODE = "code"

const byExtension: Record<string, string[]> = {
	// `typescript` brings the grammar for the dialect the filename names, so
	// pairing it with `js`/`jsx`/`ts`/`tsx` would install two languages.
	".js": ["typescript"],
	".mjs": ["typescript"],
	".cjs": ["typescript"],
	".jsx": ["typescript"],
	".ts": ["typescript"],
	".mts": ["typescript"],
	".cts": ["typescript"],
	".tsx": ["typescript"],
	".css": ["css"],
	".html": ["html"],
	".htm": ["html"],
	".svelte": ["html"],
	".vue": ["html"],
	".json": ["json"],
	".jsonc": ["json"],
	".md": ["codemirror-markdown"],
	".markdown": ["codemirror-markdown"],
	".mdx": ["codemirror-markdown"],
	".py": ["python"],
	".xml": ["xml"],
	".svg": ["xml"],
	".yaml": ["yaml"],
	".yml": ["yaml"],
	".rs": ["rust"],
	".c": ["cpp"],
	".h": ["cpp"],
	".cpp": ["cpp"],
	".hpp": ["cpp"],
	".cc": ["cpp"],
	".cxx": ["cpp"],
	".java": ["java"],
	".php": ["php"],
	".sql": ["sql"],
	".wat": ["wast"],
	".wast": ["wast"],
}

const byMimeType: Record<string, string[]> = {
	"text/javascript": ["typescript"],
	"application/javascript": ["typescript"],
	"text/typescript": ["typescript"],
	"text/css": ["css"],
	"text/html": ["html"],
	"application/json": ["json"],
	"text/markdown": ["codemirror-markdown"],
	"text/x-python": ["python"],
	"text/xml": ["xml"],
	"application/xml": ["xml"],
	"image/svg+xml": ["xml"],
	"text/yaml": ["yaml"],
	"text/x-yaml": ["yaml"],
	"text/x-rustsrc": ["rust"],
	"text/x-csrc": ["cpp"],
	"text/x-c++src": ["cpp"],
	"text/x-java": ["java"],
	"text/x-sql": ["sql"],
}

// The `plugins` attribute for the editor component: absent (so the document's
// own array wins, and `/plugins` can edit it) when the file has one, otherwise
// the defaults for this file's extension or mime type.
export function pluginsAttribute(doc: {
	extension?: string
	mimeType?: string
	"@text-editor"?: {plugins?: string[]}
}): string | undefined {
	if (Array.isArray(doc?.["@text-editor"]?.plugins)) return undefined
	return pluginsForFile(doc?.extension, doc?.mimeType).join(",")
}

export function pluginsForFile(
	extension?: string,
	mimeType?: string,
): string[] {
	if (extension) {
		const ext = extension.startsWith(".") ? extension : `.${extension}`
		const ids = byExtension[ext]
		if (ids) return [CODE, ...ids]
	}
	if (mimeType) {
		const ids = byMimeType[mimeType]
		if (ids) return [CODE, ...ids]
	}
	return [CODE]
}
