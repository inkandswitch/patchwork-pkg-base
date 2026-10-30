// Whether a row's document is a package, and how it's doing: read late from
// patchwork's ModuleWatcher (`patchwork.packages`), which reports each package's
// status and fires "status" when one changes. A patchwork without that just
// shows no status.
import { createSignal, onCleanup, type Accessor } from "solid-js";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";

export type PackageStatus =
  | { state: "loading" }
  | { state: "loaded"; plugins: string[] }
  | { state: "failed"; error: string };

type Packages = EventTarget & {
  packageStatus(urlOrDocumentId: string): PackageStatus | undefined;
};

function packages(): Packages | undefined {
  const candidate = (globalThis as { patchwork?: { packages?: Partial<Packages> } })
    .patchwork?.packages;
  return typeof candidate?.packageStatus === "function" &&
    typeof candidate.addEventListener === "function"
    ? (candidate as Packages)
    : undefined;
}

export function usePackageStatus(
  url: Accessor<AutomergeUrl>
): Accessor<PackageStatus | undefined> {
  const watcher = packages();
  const [version, setVersion] = createSignal(0);
  if (watcher) {
    const changed = () => setVersion((n) => n + 1);
    watcher.addEventListener("status", changed);
    onCleanup(() => watcher.removeEventListener("status", changed));
  }
  return () => {
    version();
    return watcher?.packageStatus(url());
  };
}

export function packageTooltip(status: PackageStatus): string {
  switch (status.state) {
    case "loaded":
      return `Loaded: ${status.plugins.join(", ") || "no plugins"}`;
    case "failed":
      return `Failed to load: ${status.error}`;
    case "loading":
      return "Loading…";
  }
}
