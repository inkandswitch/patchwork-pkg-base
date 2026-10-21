import type { Repo, DocHandle } from "@automerge/automerge-repo/slim";
import type {
  FolderDoc,
  HasPatchworkMetadata,
  UnixFileEntry,
} from "@inkandswitch/patchwork-filesystem";
import type { Landed } from "../dnd/operations.ts";
import { log } from "../dnd/debug.ts";

/**
 * Turn files dropped from the operating system into UnixFileEntry documents
 * and insert them into `folderHandle` at `index`, in the order they were
 * dropped. A file that can't be read is skipped and named in `failed`; the
 * rest still go in.
 */
export async function handleFilesDrop(
  files: Iterable<File>,
  folderHandle: DocHandle<FolderDoc>,
  repo: Repo,
  index: number
): Promise<{ landed: Landed[]; failed: string[] }> {
  const landed: Landed[] = [];
  const failed: string[] = [];
  let at = index;

  for (const file of files) {
    try {
      const content = new Uint8Array(await file.arrayBuffer());

      const nameParts = file.name.split(".");
      const extension = nameParts.length > 1 ? nameParts.pop()! : "";
      const nameWithoutExt = nameParts.join(".");

      const handle = await repo.create2<UnixFileEntry & HasPatchworkMetadata>({
        "@patchwork": {
          type: "file",
        },
        content,
        extension,
        mimeType: file.type || "application/octet-stream",
        name: nameWithoutExt,
      });

      // Each file goes after the one before it, so they keep their order.
      const insertAt = Math.min(at, folderHandle.doc()?.docs?.length ?? 0);
      folderHandle.change((folder) => {
        folder.docs.splice(insertAt, 0, {
          url: handle.url,
          name: file.name,
          type: "file",
        });
      });
      landed.push({ folderUrl: folderHandle.url, index: insertAt, url: handle.url });
      at = insertAt + 1;

      log("FileDrop: Created file document:", file.name, handle.url);
    } catch (error) {
      log("FileDrop: Failed to create file document:", error);
      failed.push(file.name);
    }
  }

  return { landed, failed };
}
