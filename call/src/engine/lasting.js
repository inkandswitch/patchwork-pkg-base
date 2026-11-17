// what has to outlast the module it's made in. a dev server's changes are
// swapped in where you are (as lattice's dev-swap.js does): every module's imported
// again, from a new url, so each starts with its variables empty, while the
// page carries on, and a call in it. what's made here is made once a page:
// every version of a module that asks for `key` gets the same one back. for
// what's live (a call's connections, its streams), which can't be kept in
// storage; what can be, kept.js keeps, and that outlasts a reload too
const ALL = Symbol.for("patchwork-call:lasting");

/** the page's one `key`, made by `make` the first time it's asked for */
export function lasting(key, make) {
  const all = (globalThis[ALL] ??= new Map());
  if (!all.has(key)) all.set(key, make());
  return all.get(key);
}
