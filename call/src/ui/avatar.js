// a face's picture: the avatar doc, through patchwork's service worker. if
// that isn't to be had, faces are initials
const avatarSrc = await import("@inkandswitch/patchwork-filesystem").then(
  (filesystem) => filesystem.automergeUrlToServiceWorkerUrl,
  () => null,
);
export function faceImage(url) {
  try {
    return url && avatarSrc ? avatarSrc(url) : null;
  } catch {
    return null;
  }
}
