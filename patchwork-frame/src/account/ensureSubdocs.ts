import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import {
  createDocOfDatatype2,
  getRegistry,
  type DatatypeDescription,
  type LoadedDatatype,
} from "@inkandswitch/patchwork-plugins";
import type { AccountDoc } from "../types";

type SubdocField = "rootFolderUrl" | "moduleSettingsUrl" | "contactUrl";

type FolderDoc = {
  title?: string;
  docs?: unknown[];
  workspaceUrl?: AutomergeUrl;
};

async function loadDatatypeWhenReady<D>(
  id: string
): Promise<LoadedDatatype<D> | undefined> {
  const registry = getRegistry<DatatypeDescription>("patchwork:datatype");
  const immediate = await registry.load(id);
  if (immediate) return immediate as LoadedDatatype<D>;
  return new Promise((resolve) => {
    const off = registry.on("registered", async (plugin) => {
      if (plugin.id !== id) return;
      off();
      resolve((await registry.load(id)) as LoadedDatatype<D> | undefined);
    });
  });
}

async function ensureSubdoc<S>(
  accountHandle: DocHandle<AccountDoc>,
  repo: Repo,
  field: SubdocField,
  datatypeId: string
) {
  if (accountHandle.doc()?.[field]) return;
  const datatype = await loadDatatypeWhenReady<S>(datatypeId);
  if (!datatype) {
    console.warn(
      `frame: datatype "${datatypeId}" never registered; skipping ${field}`
    );
    return;
  }
  if (accountHandle.doc()?.[field]) return;
  const subHandle = await createDocOfDatatype2<S>(datatype, repo);
  accountHandle.change((doc) => {
    if (!doc[field]) doc[field] = subHandle.url;
  });
}

async function ensureFolderWorkspace(
  accountHandle: DocHandle<AccountDoc>,
  repo: Repo
) {
  const folderUrl = accountHandle.doc()?.rootFolderUrl;
  if (!folderUrl) return;

  const folderHandle = await repo.find<FolderDoc>(folderUrl);
  await folderHandle.whenReady();
  if (folderHandle.doc()?.workspaceUrl) return;

  const datatype = await loadDatatypeWhenReady("patchwork:workspace");
  if (!datatype) {
    console.warn(
      `frame: datatype "patchwork:workspace" never registered; folder missing workspaceUrl`
    );
    return;
  }
  if (folderHandle.doc()?.workspaceUrl) return;

  const wsHandle = await createDocOfDatatype2(datatype, repo);
  folderHandle.change((d) => {
    if (!d.workspaceUrl) d.workspaceUrl = wsHandle.url;
  });
}

// already set (including those set concurrently by another tab) win.
export async function ensureAccountSubdocs(
  accountHandle: DocHandle<AccountDoc>,
  repo: Repo
) {
  await Promise.all([
    ensureSubdoc(accountHandle, repo, "rootFolderUrl", "folder"),
    ensureSubdoc(
      accountHandle,
      repo,
      "moduleSettingsUrl",
      "patchwork:module-settings"
    ),
    ensureSubdoc(accountHandle, repo, "contactUrl", "contact"),
  ]);
  await ensureFolderWorkspace(accountHandle, repo);
}
