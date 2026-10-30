// The account's `/packages` folders, live, for the module-settings doc that is
// the account's own. Everything comes from the host at runtime, through
// `globalThis.patchwork`: its account, its own repo (not the tool element's,
// which a checked-out draft remaps to clones), and its package watcher, whose
// `addPackagesFolder` says it loads `/packages`. A host without that has no
// folders here, and the tool installs into module settings as before.

import { createMemo, createSignal, onCleanup } from "solid-js";
import { documentIdOf } from "./origin.ts";
import { resolvePackageMeta } from "./pkg-meta.ts";
import { packagesFolderUrls, type AccountLike, type FolderHandle } from "./packages-folder.ts";
import type { Describe, FolderLink, Folders } from "./install.ts";

type Listenable = {
  on?(event: "change", listener: () => void): void;
  off?(event: "change", listener: () => void): void;
};
type Found = FolderHandle & Listenable;
type RepoLike = { find(url: string): Promise<unknown> };

export type FoldersEnv = {
  account?: { doc(): (ReturnType<AccountLike["doc"]> & { moduleSettingsUrl?: unknown }) | undefined } & Listenable;
  repo?: RepoLike;
  hostLoadsPackages: boolean;
};

/** The host's account, repo, and whether it loads `/packages`. */
export function hostEnv(element: unknown): FoldersEnv {
  const patchwork = (
    globalThis as {
      patchwork?: {
        account?: FoldersEnv["account"];
        repo?: RepoLike;
        packages?: { addPackagesFolder?: unknown };
      };
    }
  ).patchwork;
  return {
    account: patchwork?.account,
    repo: patchwork?.repo ?? (element as { repo?: RepoLike } | undefined)?.repo,
    hostLoadsPackages: typeof patchwork?.packages?.addPackagesFolder === "function",
  };
}

const READ_MS = 5_000;
const within = <T>(work: Promise<T>, ms: number) =>
  Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms)),
  ]);

/** A package's name (package.json, else title) and type, for its folder link. */
export function describeWith(repo: RepoLike | undefined): Describe {
  return async (url) => {
    const [meta, doc] = await Promise.all([
      within(resolvePackageMeta(url), READ_MS).catch(() => undefined),
      repo
        ? within(repo.find(url), READ_MS)
            .then(
              (handle) =>
                (handle as { doc?(): unknown }).doc?.() as
                  | { "@patchwork"?: { type?: string }; title?: string }
                  | undefined
            )
            .catch(() => undefined)
        : undefined,
    ]);
    const name = meta?.name || doc?.title || meta?.title || documentIdOf(url) || url;
    return { name, type: doc?.["@patchwork"]?.type || "folder" };
  };
}

// How long an install waits for your folder before giving up.
const FOLDER_WAIT_MS = 10_000;

/**
 * The folders bound at `/packages`, when `viewingUrl` is the account's own
 * module-settings doc: installing from another package list leaves your
 * account alone.
 */
export function usePackagesFolders(
  env: FoldersEnv,
  viewingUrl: string,
  retryMs = 10_000
): Folders {
  const [version, setVersion] = createSignal(0);
  const bump = () => setVersion((n) => n + 1);
  let disposed = false;

  env.account?.on?.("change", bump);
  const urls = createMemo(() => {
    version();
    if (!env.hostLoadsPackages || !env.repo) return [];
    const own = env.account?.doc()?.moduleSettingsUrl;
    if (typeof own !== "string" || documentIdOf(own) !== documentIdOf(viewingUrl)) return [];
    return packagesFolderUrls(env.account);
  });

  const finding = new Map<string, Promise<Found | undefined>>();
  const found = new Map<string, Found>();
  const retries = new Set<ReturnType<typeof setTimeout>>();
  const find = (url: string) => {
    let promise = finding.get(url);
    if (!promise) {
      promise = env
        .repo!.find(url)
        .then((handle) => {
          const folder = handle as Found;
          if (disposed) return folder;
          found.set(url, folder);
          folder.on?.("change", bump);
          bump();
          return folder;
        })
        .catch(() => {
          // Not available yet: ask again in a while.
          finding.delete(url);
          if (!disposed) {
            const retry = setTimeout(() => {
              retries.delete(retry);
              bump();
            }, retryMs);
            retries.add(retry);
          }
          return undefined;
        });
      finding.set(url, promise);
    }
    return promise;
  };
  onCleanup(() => {
    disposed = true;
    env.account?.off?.("change", bump);
    for (const folder of found.values()) folder.off?.("change", bump);
    for (const retry of retries) clearTimeout(retry);
  });

  const links = createMemo(() => {
    version();
    const map = new Map<string, FolderLink>();
    urls().forEach((url, index) => {
      void find(url);
      const folder = found.get(url);
      const names = new Set<string>();
      for (const entry of folder?.doc()?.docs ?? []) {
        // As the host: only the first of a name in a folder is reachable.
        const name = String(entry?.name);
        if (names.has(name)) continue;
        names.add(name);
        const id = documentIdOf(String(entry?.url));
        if (!id) continue;
        const known = map.get(id);
        if (known) {
          if (index > 0) known.shared = true;
          continue;
        }
        map.set(id, {
          folderUrl: url,
          title: folder?.doc()?.title ?? "packages",
          mine: index === 0,
          shared: index > 0,
        });
      }
    });
    return map;
  });

  return {
    hasMine: () => urls().length > 0,
    mine: async () => {
      const url = urls()[0];
      if (!url) return undefined;
      const folder = await within(find(url), FOLDER_WAIT_MS);
      if (!folder) throw new Error("couldn't load your packages folder");
      return folder;
    },
    links,
  };
}
