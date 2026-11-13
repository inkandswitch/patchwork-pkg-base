// a room is where a call is: a doc (its url, bare: no heads, no path, so
// every draft and version of it is the same room) or a key (32 bytes, as
// hex: for meeting where there's no doc, which isn't built yet, see
// channel.js)
import { isValidAutomergeUrl } from "@automerge/automerge-repo/slim";

const KEY = /^key:([0-9a-f]{64})$/i;

/** the room `url` names (a doc url, or "key:<hex>"), as a room id, or null */
export function roomUrl(url) {
  if (typeof url !== "string") return null;
  const key = KEY.exec(url);
  if (key) return `key:${key[1].toLowerCase()}`;
  if (!url.startsWith("automerge:")) return null;
  const bare = url.split(/[#/]/, 1)[0];
  return isValidAutomergeUrl(bare) ? bare : null;
}

/** the room for 32 bytes of key */
export function keyRoom(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) {
    throw new RangeError("a key room is 32 bytes");
  }
  return `key:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export const isKeyRoom = (id) => typeof id === "string" && KEY.test(id);

/** the page's repo, wherever this host put it (not a draft overlay's) */
export function pageRepo() {
  return globalThis.repo ?? globalThis.patchwork?.repo ?? null;
}

/** what a doc's called, by its datatype, or its own title, or nothing */
export async function titleOf(handle) {
  const doc = handle?.doc?.();
  if (!doc) return "";
  const type = doc["@patchwork"]?.type;
  if (type) {
    try {
      const { getRegistry } = await import("@inkandswitch/patchwork-plugins");
      const datatype = await getRegistry("patchwork:datatype").load(type);
      const title = datatype?.module?.getTitle?.(doc);
      if (typeof title === "string" && title) return title;
    } catch {}
  }
  return typeof doc.title === "string" ? doc.title : "";
}
