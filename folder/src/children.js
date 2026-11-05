import {
  DIRECTORY_RESERVED,
  asUrl,
  folderLinks,
  isDirectoryDoc,
} from "./links.js";

/**
 * The docs a folder holds, in entry order. A folder entry records its doc's
 * datatype, so walkers can skip loading leaves.
 * @returns {{ url: string, type?: string }[]}
 */
export function folderChildren(doc) {
  return folderLinks(doc).map(({ url, type }) => ({
    url,
    type: type || undefined,
  }));
}

/**
 * The files of a pushwork directory doc, at every depth. Their links don't
 * record a datatype.
 * @returns {{ url: string }[]}
 */
export function directoryChildren(doc) {
  if (!isDirectoryDoc(doc)) return [];
  const children = [];
  for (const [key, value] of Object.entries(doc)) {
    if (DIRECTORY_RESERVED.has(key)) continue;
    const url = asUrl(value);
    if (url) children.push({ url });
  }
  return children;
}
