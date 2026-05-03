import { For, Show, createMemo, createResource } from "solid-js";
import { makeDocumentProjection } from "solid-automerge";
import {
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";
import { automergeUrlToServiceWorkerUrl } from "@inkandswitch/patchwork-filesystem";
import type { OpenDocumentEventDetail } from "@inkandswitch/patchwork-elements";
import { ModuleControls } from "./ModuleControls.tsx";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard.ts";
import type { EnrichedPlugin } from "../hooks/useModulePlugins.ts";
import {
  resolveModuleEntryToFolderUrl,
  type ModuleSettingsDocWithBranches,
} from "../utils/module-types.ts";
import {
  forceActivatePlugin,
  sameAutomergeDoc,
  useActiveImportUrl,
} from "../utils/plugin-registry.ts";

interface PackageListProps {
  moduleUrls: AutomergeUrl[];
  plugins: EnrichedPlugin[];
  onRemoveModule: (url: AutomergeUrl) => void;
  repo: Repo;
  settingsHandle: DocHandle<ModuleSettingsDocWithBranches>;
}

export function PackageList(props: PackageListProps) {
  const pluginsByModule = createMemo(() => {
    const map = new Map<string, EnrichedPlugin[]>();
    for (const plugin of props.plugins) {
      if (!plugin.importUrl) continue;
      const url = String(plugin.importUrl);
      const list = map.get(url);
      if (list) list.push(plugin);
      else map.set(url, [plugin]);
    }
    return map;
  });

  // Preserve module order from settings doc; only show modules whose
  // plugin list is non-empty after filtering.
  const visiblePackages = createMemo(() => {
    const grouped = pluginsByModule();
    return props.moduleUrls.filter((url) => grouped.has(String(url)));
  });

  return (
    <ul class="msm-cards">
      <For each={visiblePackages()}>
        {(url) => (
          <PackageCard
            url={url}
            plugins={pluginsByModule().get(String(url))!}
            repo={props.repo}
            settingsHandle={props.settingsHandle}
            onRemove={() => props.onRemoveModule(url)}
          />
        )}
      </For>
    </ul>
  );
}

interface PackageCardProps {
  url: AutomergeUrl;
  plugins: EnrichedPlugin[];
  repo: Repo;
  settingsHandle: DocHandle<ModuleSettingsDocWithBranches>;
  onRemove: () => void;
}

function PackageCard(props: PackageCardProps) {
  const [copiedUrl, copyUrl] = useCopyToClipboard();
  const settingsDoc = makeDocumentProjection(props.settingsHandle);

  // Re-fetch when URL or chosen branch (if branches doc) changes.
  const sourceKey = () =>
    `${String(props.url)}|${settingsDoc.branches?.[props.url] ?? ""}`;

  const [folderUrl] = createResource(sourceKey, async () => {
    try {
      return await resolveModuleEntryToFolderUrl(
        props.repo,
        props.url,
        settingsDoc
      );
    } catch {
      return undefined;
    }
  });

  const [pkgInfo] = createResource(folderUrl, async (url) => {
    try {
      if (!url) return null;
      const pkgJsonUrl = new URL(
        "package.json",
        new URL(automergeUrlToServiceWorkerUrl(url), window.location.origin)
      ).href;
      const res = await fetch(pkgJsonUrl);
      if (!res.ok) return null;
      const pkg = await res.json();
      return {
        title: pkg.title as string | undefined,
        name: pkg.name as string | undefined,
        version: pkg.version as string | undefined,
      };
    } catch {
      return null;
    }
  });

  const handleViewSource = (e: MouseEvent) => {
    const detail: OpenDocumentEventDetail = {
      url: props.url,
      toolId: "raw",
    };
    (e.currentTarget as HTMLButtonElement).dispatchEvent(
      new CustomEvent("patchwork:open-document", {
        detail,
        bubbles: true,
        composed: true,
      })
    );
  };

  return (
    <li class="msm-card">
      <header class="msm-card__heading">
        <h3 class="msm-card__name">
          {pkgInfo()?.title ?? pkgInfo()?.name ?? "(unnamed package)"}
        </h3>
        <Show when={pkgInfo()?.version}>
          <div class="msm-card__meta">v{pkgInfo()?.version}</div>
        </Show>
      </header>

      <code
        class="msm-card__url"
        classList={{ "msm-card__url--copied": copiedUrl() === props.url }}
        onClick={() => copyUrl(props.url)}
        title="Click to copy URL"
      >
        {copiedUrl() === props.url ? "copied" : props.url}
      </code>

      <Show when={props.plugins.length > 0}>
        <div class="msm-card__contributes">
          {/* <span class="msm-card__row-label">Contributes</span> */}
          <ul class="msm-card__plugins">
            <For each={props.plugins}>
              {(plugin) => (
                <PluginItem plugin={plugin} folderUrl={folderUrl()} />
              )}
            </For>
          </ul>
        </div>
      </Show>

      <div class="msm-card__action-row">
        <div class="msm-card__action-row-left">
          <ModuleControls
            url={props.url}
            repo={props.repo}
            settingsHandle={props.settingsHandle}
            plugins={props.plugins}
          />
        </div>
        <div class="msm-card__action-row-right">
          <button class="msm-card__text-btn" onClick={handleViewSource}>
            View source
          </button>
          <button
            class="msm-card__text-btn msm-card__text-btn--danger"
            onClick={props.onRemove}
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}

function PluginItem(props: {
  plugin: EnrichedPlugin;
  folderUrl: AutomergeUrl | undefined;
}) {
  const [copiedId, copyId] = useCopyToClipboard();
  const activeImportUrl = useActiveImportUrl(
    () => props.plugin.type,
    () => props.plugin.id
  );
  const status = createMemo<"active" | "shadowed" | "inactive" | "unknown">(
    () => {
      if (!props.plugin.id) return "unknown";
      const active = activeImportUrl();
      if (!active) return "inactive";
      if (sameAutomergeDoc(active, props.folderUrl)) return "active";
      return "shadowed";
    }
  );
  return (
    <li class="msm-plugin">
      <div class="msm-plugin__row">
        <span
          class="msm-plugin__status"
          classList={{
            "msm-plugin__status--active": status() === "active",
            "msm-plugin__status--shadowed": status() === "shadowed",
            "msm-plugin__status--inactive": status() === "inactive",
          }}
          title={
            status() === "active"
              ? "active"
              : status() === "shadowed"
                ? `shadowed by: ${activeImportUrl()}`
                : status() === "inactive"
                  ? "not registered"
                  : "no id"
          }
        />
        <span class="msm-plugin__name">{props.plugin.name}</span>
        <Show when={props.plugin.id}>
          <code
            class="msm-plugin__id"
            classList={{
              "msm-plugin__id--copied": copiedId() === props.plugin.id,
            }}
            onClick={() => copyId(props.plugin.id)}
            title="Click to copy ID"
          >
            {copiedId() === props.plugin.id ? "copied" : props.plugin.id}
          </code>
        </Show>
      </div>
      <div class="msm-plugin__field">
        <span
          class="msm-plugin__type"
          classList={{
            [`msm-plugin__type--${props.plugin.type.replace(/:/g, "--")}`]: true,
            [`msm-plugin__type--${props.plugin.type.replace(/patchwork:/g, "")}`]: true,
          }}
        >
          {prettyType(props.plugin.type)}
        </span>
      </div>

      <Show when={props.plugin.datatypesDisplay.type !== "empty"}>
        <div class="msm-plugin__supports">
          <span class="msm-plugin__supports-label">supports</span>
          <For each={props.plugin.datatypesDisplay.values}>
            {(dt, i) => (
              <>
                <Show when={i() > 0}>
                  <span class="msm-plugin__supports-sep">,</span>
                </Show>
                <span
                  class="msm-plugin__supports-item"
                  classList={{
                    "msm-plugin__supports-item--any":
                      props.plugin.datatypesDisplay.type === "any",
                    "msm-plugin__supports-item--none":
                      props.plugin.datatypesDisplay.type === "none",
                  }}
                >
                  {dt}
                </span>
              </>
            )}
          </For>
        </div>
      </Show>
      <Show
        when={
          (status() === "shadowed" || status() === "inactive") &&
          props.folderUrl
        }
      >
        <button
          class="msm-plugin__activate"
          onClick={() =>
            forceActivatePlugin(props.plugin, props.folderUrl as string)
          }
          title={
            status() === "shadowed"
              ? `Currently active from ${activeImportUrl()} — click to take over`
              : "Register this version as the live one"
          }
        >
          activate
        </button>
      </Show>
    </li>
  );
}

function prettyType(type: string) {
  if (type.startsWith("patchwork:")) return type.slice("patchwork:".length);
  return type;
}
