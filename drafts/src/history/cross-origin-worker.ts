// A Worker that can start from a script on another origin, which browsers
// refuse: tools are often served from somewhere other than the page, so those
// start from a blob that imports the real script.
//
// Import it as `Worker`, because vite only bundles a worker when it sees
// `new Worker(new URL("./x.ts", import.meta.url))`.
export class CrossOriginWorker extends Worker {
  constructor(url: string | URL, options?: WorkerOptions) {
    super(sameOrigin(url, options?.type), options);
  }
}

function sameOrigin(url: string | URL, type: WorkerType | undefined): string | URL {
  const href = new URL(url, document.baseURI);
  if (href.origin === location.origin) return href;
  const src = JSON.stringify(href.href);
  const boot = type === "module" ? `import ${src}` : `importScripts(${src})`;
  // Not revoked, since the worker may not have fetched it yet.
  return URL.createObjectURL(new Blob([boot], { type: "text/javascript" }));
}
