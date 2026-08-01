// A file doesn't store a `plugins` array -- its editor is derived from its name
// every time it's opened, so renaming a file changes how it's edited. These are
// `codemirror:extension` ids from text-editor-extensions-code (and -markdown),
// handed to the editor component.

const CODE = "code"

const byExtension: Record<string, string[]> = {
	".js": ["javascript", "typescript"],
	".mjs": ["javascript", "typescript"],
	".cjs": ["javascript", "typescript"],
	".jsx": ["javascript", "typescript"],
	".ts": ["javascript", "typescript"],
	".mts": ["javascript", "typescript"],
	".cts": ["javascript", "typescript"],
	".tsx": ["javascript", "typescript"],
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
	"text/javascript": ["javascript", "typescript"],
	"application/javascript": ["javascript", "typescript"],
	"text/typescript": ["javascript", "typescript"],
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
