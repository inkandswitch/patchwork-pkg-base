import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import {
  RepoContext,
  useDocHandle,
  useDocument,
  useRepo,
} from "@automerge/react";
import {
  Tldraw,
  useEditor,
  getMediaAssetInfoPartial,
  type VecLike,
  type TLContent,
  type TLAssetId,
  type TLAsset,
} from "@tldraw/tldraw";
import {
  useAutomergeStore,
  useAutomergePresence,
} from "./lith/useAutomergeStore.ts";
import type { TLDrawDoc } from "./datatype.ts";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { UnixFileEntry } from "@inkandswitch/patchwork-filesystem";
import { automergeUrlToServiceWorkerUrl } from "@inkandswitch/patchwork-filesystem";
import { useDocRequest } from "@inkandswitch/patchwork-providers-react";
import { decodeHeads, type UrlHeads } from "@automerge/automerge-repo";
import { createRoot } from "react-dom/client";
import { diffStore, type ShapeDiff } from "./diff.ts";
import { DiffContext, diffComponents } from "./DiffOverlay.tsx";

// Baseline served by the draft overlay (`patchwork:baseline`). When `heads`
// is absent there is no baseline and no diff is rendered (e.g. on "main").
type Baseline = { heads?: UrlHeads };

const VERSION = "v0.2.0-diff";

function VersionBadge() {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 4,
        right: 6,
        fontSize: 11,
        fontWeight: 500,
        color: "var(--color-text-3, #9ca3af)",
        pointerEvents: "none",
        userSelect: "none",
        zIndex: 1,
      }}
      title="tldraw tool version"
    >
      tldraw {VERSION}
    </div>
  );
}

const components = { ...diffComponents, InFrontOfTheCanvas: VersionBadge };

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

function extensionForMimeType(mimeType: string): string {
  return MIME_TO_EXT[mimeType] || mimeType.split("/")[1] || "bin";
}

interface ContactDoc {
  type: string;
  name?: string;
  color?: string;
}

function useContactInfo() {
  const [contactUrl, setContactUrl] = useState<AutomergeUrl | undefined>();

  useEffect(() => {
    const accountDocHandle = (window as any).accountDocHandle as
      | DocHandle<{ contactUrl: AutomergeUrl }>
      | undefined;
    if (!accountDocHandle) return;
    accountDocHandle.whenReady().then(() => {
      const doc = accountDocHandle.doc();
      if (doc?.contactUrl) {
        setContactUrl(doc.contactUrl);
      }
    });
  }, []);

  const [contactDoc] = useDocument<ContactDoc>(contactUrl);

  return {
    userId: contactUrl ?? (window as any).repo?.peerId ?? "anonymous",
    name: contactDoc?.name ?? "Anonymous",
    color: contactDoc?.color,
  };
}

export function TldrawTool({
  docUrl,
  element,
}: {
  docUrl: AutomergeUrl;
  element: HTMLElement;
}) {
  const handle = useDocHandle<TLDrawDoc>(docUrl, { suspense: true });
  const contactInfo = useContactInfo();
  const store = useAutomergeStore({ handle, userId: contactInfo.userId });

  useAutomergePresence({
    handle: handle as DocHandle<any>,
    store,
    userMetadata: contactInfo,
  });

  const [baseline] = useDocRequest<Baseline>(element, "patchwork:baseline", {
    url: docUrl,
  });
  const diff = useShapeDiff(handle, baseline?.heads);

  return (
    <DiffContext.Provider value={diff}>
      <Tldraw inferDarkMode autoFocus store={store} components={components}>
        <TldrawInner docUrl={docUrl} />
      </Tldraw>
    </DiffContext.Provider>
  );
}

// Recomputes the diff against `heads` on every doc change. `baseline.heads`
// only moves when the draft is forked (copy-on-write), so without listening
// to the handle the diff would freeze after the first computation — same
// reasoning as `codemirror-base`'s `docTick`. The bump is deferred to a
// microtask so we never recompute synchronously from inside the sync layer's
// own `handle.change` callback.
function useShapeDiff(
  handle: DocHandle<TLDrawDoc>,
  heads: UrlHeads | undefined
): ShapeDiff | null {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let scheduled = false;
    const onChange = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        setTick((t) => t + 1);
      });
    };
    handle.on("change", onChange);
    return () => {
      handle.off("change", onChange);
    };
  }, [handle]);

  return useMemo(() => {
    if (!heads) return null;
    const doc = handle.doc();
    if (!doc) return null;
    try {
      return diffStore(doc, decodeHeads(heads));
    } catch (error) {
      console.warn("[tldraw4/diff] failed to compute diff", error);
      return null;
    }
    // `tick` is intentionally a dependency: it forces recompute on doc change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, heads, tick]);
}

function TldrawInner(props: { docUrl: AutomergeUrl }) {
  const key = useMemo(() => `${props.docUrl}-camera`, [props.docUrl]);

  const editor = useEditor();
  const repo = useRepo();

  const onChange = useCallback(() => {
    if (!editor) return;
    const camstate = editor.getCameraState();
    if (camstate == "moving") {
      // todo debounce?
      localStorage.setItem(key, JSON.stringify(editor.getCamera()));
    }
  }, []);

  useEffect(() => {
    if (!editor) return;

    // Handle pasted/dropped files (images, videos) by storing them as
    // UnixFileEntry automerge docs and referencing them via service-worker URLs.
    editor.registerExternalAssetHandler("file", async ({ file, assetId }) => {
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");

      // Create a stable asset ID if one wasn't provided
      const id = assetId ?? (`asset:${crypto.randomUUID()}` as TLAssetId);

      // Read the file bytes
      const bytes = new Uint8Array(await file.arrayBuffer());

      // Determine extension and name
      const ext = extensionForMimeType(file.type);
      const name =
        file.name && file.name !== "image.png"
          ? file.name
          : `Pasted image on ${new Date().toLocaleDateString()}.${ext}`;

      // Create an automerge doc for the file
      const fileHandle = repo.create<UnixFileEntry>();
      fileHandle.change((doc) => {
        doc.content = bytes;
        doc.extension = ext;
        doc.mimeType = file.type;
        doc.name = name;
      });

      // Build the asset using tldraw's helper to get dimensions etc.
      const asset = await getMediaAssetInfoPartial(file, id, isImage, isVideo);

      // Point the asset's src at the service-worker URL for this doc
      asset.props.src = automergeUrlToServiceWorkerUrl(fileHandle.url);

      return asset as TLAsset;
    });

    // Override the tldraw paste handler to avoid "could not migrate content"
    // errors when pasting from newer tldraw versions (e.g. tldraw.com may
    // run a canary build whose schema sequence versions are ahead of ours).
    editor.registerExternalContentHandler(
      "tldraw",
      ({ point, content }: { point?: VecLike; content: TLContent }) => {
        editor.run(() => {
          const selectionBoundsBefore = editor.getSelectionPageBounds();
          editor.markHistoryStoppingPoint("paste");

          for (const shape of content.shapes) {
            if (content.rootShapeIds.includes(shape.id)) {
              shape.isLocked = false;
            }
          }

          // Replace the pasted content's schema with ours so that
          // migrateStoreSnapshot sees matching versions and skips migration
          // rather than failing on unknown future sequence versions.
          content.schema = editor.store.schema.serialize();

          editor.putContentOntoCurrentPage(content, {
            point,
            select: true,
          });

          const selectedBoundsAfter = editor.getSelectionPageBounds();
          if (
            selectionBoundsBefore &&
            selectedBoundsAfter &&
            selectionBoundsBefore.collides(selectedBoundsAfter)
          ) {
            editor.updateInstanceState({ isChangingStyle: true });
          }
        });
      }
    );

    const existing = localStorage.getItem(key);
    if (existing) {
      try {
        const cam = JSON.parse(existing);
        editor.setCamera(cam);
      } catch {
        localStorage.removeItem(key);
      }
    }
    editor.on("change", onChange);
    return () => void editor.off("change", onChange);
  }, [editor]);
  return null;
}

export function render(handle: any, element: any) {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <TldrawTool docUrl={handle.url} element={element} />
    </RepoContext.Provider>
  );
  return () => root.unmount();
}
