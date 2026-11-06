import {
  isValidAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo/slim";

export type HashParam = "doc" | "workspace" | "draft";

// Automerge URLs, kept literal rather than percent-encoded, as core's router
// writes them.
const RAW_HASH_KEYS: ReadonlySet<string> = new Set(["doc", "workspace", "draft"]);

export function readHashParam(key: HashParam): AutomergeUrl | null {
  const raw = new URLSearchParams(window.location.hash.slice(1)).get(key);
  if (!raw) return null;
  // Older links carry the doc as a bare document id.
  const url = key === "doc" && !raw.startsWith("automerge:") ? `automerge:${raw}` : raw;
  return isValidAutomergeUrl(url) ? url : null;
}

// Rewrites the hash in place, without a `hashchange` or a history entry.
export function writeHashParams(
  changes: Partial<Record<HashParam, AutomergeUrl | null>>
): void {
  const params = new URLSearchParams(window.location.hash.slice(1));
  let changed = false;
  for (const [key, value] of Object.entries(changes)) {
    if ((params.get(key) ?? null) === (value ?? null)) continue;
    if (value) params.set(key, value);
    else params.delete(key);
    changed = true;
  }
  if (!changed) return;
  try {
    history.replaceState(null, "", "#" + serializeHash(params));
  } catch {
    // Sandboxed realms can refuse replaceState; the URL is cosmetic there.
  }
}

function serializeHash(params: URLSearchParams): string {
  const parts: string[] = [];
  params.forEach((value, key) => {
    if (!value) return;
    parts.push(
      `${key}=${RAW_HASH_KEYS.has(key) ? value : encodeURIComponent(value)}`
    );
  });
  return parts.join("&");
}
