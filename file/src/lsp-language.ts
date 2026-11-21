// Code files get TypeScript's language server (completions, hovers,
// diagnostics), under the language id it knows each extension by.
const LSP_LANGUAGES: Record<string, string> = {
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	jsx: "javascriptreact",
	ts: "typescript",
	mts: "typescript",
	cts: "typescript",
	tsx: "typescriptreact",
}

export const lspLanguage = (extension?: string): string | undefined => {
	if (!extension) return undefined
	const ext = extension.startsWith(".") ? extension.slice(1) : extension
	return LSP_LANGUAGES[ext.toLowerCase()]
}
