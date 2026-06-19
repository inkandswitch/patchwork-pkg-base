import type { OpenDocumentEventDetail } from "@inkandswitch/patchwork-elements";

export function createOpenEvent(detail: OpenDocumentEventDetail) {
  return new CustomEvent("patchwork:open-document", {
    detail,
    bubbles: true,
    composed: true,
  });
}

export function createOpenUnsafeModalEvent(detail: OpenDocumentEventDetail) {
  return new CustomEvent("patchwork:open-unsafe-modal", {
    detail,
    bubbles: true,
    composed: true,
  });
}
