// what's kept in this tab (its sessionStorage, as json): still there after a
// reload, and after a dev server's changes are swapped in (lasting.js), and
// gone with the tab. nothing's kept, and the fallback's what comes back,
// wherever storage can't be had

function tabStorage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** what's kept as `key`, or `fallback` */
export function kept(key, fallback = null, storage = tabStorage()) {
  try {
    const value = storage?.getItem(key);
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** keep `value` as `key` (null or undefined: keep nothing) */
export function keep(key, value, storage = tabStorage()) {
  try {
    if (value == null) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(value));
  } catch {}
}

