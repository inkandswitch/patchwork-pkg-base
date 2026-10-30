// The account's `/packages` folders, live: the host's account (through
// `globalThis.patchwork.account`, as the sidebar finds it) and its repo (on the
// tool's element). All feature-detected: a host that doesn't load `/packages`
// has no folders here, and the tool installs into module settings as before.

import * as filesystem from "@inkandswitch/patchwork-filesystem";
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
  account?: AccountLike & Listenable;
  repo?: RepoLike;
  hostLoadsPackages: boolean;
};

/** The host's account, repo, and whether it loads `/packages`. */
export function hostEnv(element: unknown): FoldersEnv {
  const account = (globalThis as { patchwork?: { account?: FoldersEnv["account"] } }).patchwork
    ?.account;
  const repo = (element as { repo?: RepoLike } | undefined)?.repo;
  const hostLoadsPackages =
    typeof (filesystem as Record<string, unknown>).watchPackagesFolder === "function";
  return { account, repo, hostLoadsPackages };
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
            .then((handle) => (handle as { doc?(): unknown }).doc?.() as
              | { "@patchwork"?: { type?: string }; title?: string }
              | undefined)
            .catch(() => undefined)
        : undefined,
    ]);
    const name = meta?.name || doc?.title || meta?.title || documentIdOf(url) || url;
    return { name, type: doc?.["@patchwork"]?.type || "folder" };
  };
}

export function usePackagesFolders(env: FoldersEnv): Folders {
  const [version, setVersion] = createSignal(0);
  const bump = () => setVersion((n) => n + 1);

  env.account?.on?.("change", bump);
  onCleanup(() => env.account?.off?.("change", bump));

  const urls = createMemo(() => {
    version();
    return env.hostLoadsPackages && env.repo ? packagesFolderUrls(env.account) : [];
  });

  const finding = new Map<string, Promise<Found | undefined>>();
  const found = new Map<string, Found>();
  const find = (url: string) => {
    let promise = finding.get(url);
    if (!promise) {
      promise = env
        .repo!.find(url)
        .then((handle) => {
          const folder = handle as Found;
          found.set(url, folder);
          folder.on?.("change", bump);
          bump();
          return folder;
        })
        .catch(() => {
          finding.delete(url); // ask again next time
          return undefined;
        });
      finding.set(url, promise);
    }
    return promise;
  };
  onCleanup(() => {
    for (const folder of found.values()) folder.off?.("change", bump);
  });

  const links = createMemo(() => {
    version();
    const map = new Map<string, FolderLink>();
    urls().forEach((url, index) => {
      void find(url);
      const folder = found.get(url);
      for (const entry of folder?.doc()?.docs ?? []) {
        const id = documentIdOf(String(entry?.url));
        if (!id || map.has(id)) continue;
        map.set(id, { folderUrl: url, title: folder?.doc()?.title ?? "packages", mine: index === 0 });
      }
    });
    return map;
  });

  return {
    hasMine: () => urls().length > 0,
    mine: async () => {
      const url = urls()[0];
      return url ? find(url) : undefined;
    },
    links,
  };
}
