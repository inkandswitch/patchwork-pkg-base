/**
 * `new Worker(url)`, but `url` may be on another origin.
 *
 * The Worker constructor throws a SecurityError for any script that isn't
 * same-origin with the page, and patchwork serves tool bundles from wherever
 * they were deployed (a netlify preview, the service worker's origin), not from
 * the page. So a foreign script is started from a same-origin blob that imports
 * it: the blob has the page's origin, the import is an ordinary CORS fetch (the
 * same kind that loaded the tool itself), and the imported module keeps its own
 * `import.meta.url`, so whatever it resolves relative to itself still works.
 * Only `self.location` inside the worker reads as the blob.
 *
 * Import it as `Worker`: bundlers (vite) only emit a worker chunk for the
 * literal `new Worker(new URL("./x.js", import.meta.url))`, and they match the
 * text, not the binding.
 *
 *   import {CrossOriginWorker as Worker} from "./cross-origin-worker.js"
 *   new Worker(new URL("./worker.js", import.meta.url), {type: "module"})
 *
 * The base falls back to a dummy class so that importing this in a realm
 * without `Worker` (node, tests) doesn't throw.
 */
export class CrossOriginWorker extends /** @type {typeof Worker} */ (globalThis.Worker ?? class {}) {
	/**
	 * @param {string | URL} url
	 * @param {WorkerOptions} [options]
	 */
	constructor(url, options) {
		super(sameOrigin(url, options?.type), options)
	}
}

/**
 * @param {string | URL} url
 * @param {WorkerType} [type]
 */
function sameOrigin(url, type) {
	const href = new URL(url, globalThis.document?.baseURI ?? location.href)
	if (href.origin === location.origin) return href
	const src = JSON.stringify(href.href)
	const boot = type === "module" ? `import ${src}` : `importScripts(${src})`
	// Left unrevoked: it's a few bytes, and revoking before the worker has
	// fetched it races.
	return URL.createObjectURL(new Blob([boot], {type: "text/javascript"}))
}
