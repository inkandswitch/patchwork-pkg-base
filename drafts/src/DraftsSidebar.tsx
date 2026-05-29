import "./styles.css";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import {
  createDocumentProjection,
  useDocument,
} from "@automerge/automerge-repo-solid-primitives";
import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";

import { requestDoc } from "@inkandswitch/patchwork-providers-solid";
import { request } from "@inkandswitch/patchwork-providers";
import type {
  DraftDoc,
  DraftsState,
  HasDraftMarker,
} from "./draft-types";

const VERSION = "v0.2.0-per-doc";

export function DraftsSidebar(props: { element: HTMLElement }) {
  const [hostDoc, hostDocHandle] = requestDoc<HasDraftMarker>(
    props.element,
    "patchwork:host-doc"
  );

  // `@patchwork.draftUrl` is the link from a host doc to its draft tree.
  // We re-request `patchwork:draft-root` and `patchwork:drafts` whenever it
  // toggles, because the underlying `request()` is fire-and-forget and the
  // provider tears down / rebuilds those handles when the marker changes.
  const draftUrlMarker = createMemo<string | undefined>(
    () => hostDoc()?.["@patchwork"]?.draftUrl
  );

  const [rootHandle, setRootHandle] =
    createSignal<DocHandle<DraftDoc> | undefined>();
  const [stateHandle, setStateHandle] =
    createSignal<DocHandle<DraftsState> | undefined>();

  createEffect(() => {
    const marker = draftUrlMarker();
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });

    if (!marker) {
      setRootHandle(undefined);
      setStateHandle(undefined);
      return;
    }

    // The draft-root provider's reconcile is async; it may not have rebuilt
    // its handles by the time we observe the host doc change. Retry briefly
    // until both responses come back non-null.
    void (async () => {
      for (let attempt = 0; attempt < 50 && !cancelled; attempt++) {
        const [root, drafts] = await Promise.all([
          request<DocHandle<DraftDoc> | null>(
            props.element,
            "patchwork:draft-root"
          ),
          request<DocHandle<DraftsState> | null>(
            props.element,
            "patchwork:drafts"
          ),
        ]);
        if (root && drafts && !cancelled) {
          setRootHandle(() => root);
          setStateHandle(() => drafts);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    })();
  });

  const state = createDocumentProjection<DraftsState>(stateHandle);

  const drafts = createMemo<AutomergeUrl[]>(() => state()?.drafts ?? []);
  const selected = createMemo<AutomergeUrl | undefined>(
    () => state()?.selectedDraft
  );
  const hasDraftTree = createMemo(() => !!rootHandle());

  const selectDraft = (url: AutomergeUrl) => {
    stateHandle()?.change((d) => {
      d.selectedDraft = url;
    });
  };

  const getHostRepo = () =>
    request<Repo>(props.element, "patchwork:host-repo");

  const onCreateFirst = async () => {
    const docHandle = hostDocHandle();
    if (!docHandle) return;
    const repo = await getHostRepo();
    if (!repo) {
      console.warn("[drafts] no `patchwork:host-repo` available");
      return;
    }
    const rootDraft = repo.create<DraftDoc>({
      "@patchwork": { type: "draft" },
      parentDraftUrl: null,
      drafts: [],
      clones: {},
    });
    const child = repo.create<DraftDoc>({
      "@patchwork": { type: "draft" },
      parentDraftUrl: rootDraft.url,
      drafts: [],
      clones: {},
    });
    rootDraft.change((d) => {
      d.drafts.push(child.url);
    });
    docHandle.change((d) => {
      const existing = d["@patchwork"];
      const next =
        existing && typeof existing === "object" ? { ...existing } : {};
      if (!next.draftUrl) {
        next.draftUrl = rootDraft.url;
        d["@patchwork"] = next;
      }
    });
    // The provider picks up the doc change, builds DraftsState with
    // `selectedDraft = rootDraft.url`. We wait for that, then switch to
    // the new child.
    const stateReady = await waitForState(stateHandle);
    stateReady?.change((d) => {
      d.selectedDraft = child.url;
    });
  };

  const onCreateChild = async () => {
    const r = rootHandle();
    if (!r) return;
    const repo = await getHostRepo();
    if (!repo) return;
    const child = repo.create<DraftDoc>({
      "@patchwork": { type: "draft" },
      parentDraftUrl: r.url,
      drafts: [],
      clones: {},
    });
    r.change((d) => {
      d.drafts.push(child.url);
    });
    selectDraft(child.url);
  };

  // Single entry point used by the "New draft" button regardless of whether
  // the host doc already has a draft tree. If it doesn't, we bootstrap the
  // root and a child in one shot; otherwise we just add a child to the root.
  const onCreateDraft = () =>
    hasDraftTree() ? onCreateChild() : onCreateFirst();

  return (
    <div class="h-full flex flex-col p-2 gap-2">
      <div class="flex items-center justify-between text-xs text-gray-400">
        <span class="font-medium">Drafts</span>
        <span>{VERSION}</span>
      </div>

      <Show
        when={hostDoc()}
        fallback={
          <div class="text-xs text-gray-400">No document selected.</div>
        }
      >
        <div class="flex flex-col gap-1">
          <Show
            when={hasDraftTree()}
            fallback={
              <VirtualMainCard hostDocUrl={hostDocHandle()?.url} />
            }
          >
            <For each={drafts()}>
              {(url) => (
                <DraftCard
                  url={url}
                  isRoot={rootHandle()?.url === url}
                  isSelected={selected() === url}
                  onSelect={selectDraft}
                />
              )}
            </For>
          </Show>
        </div>

        <div class="flex justify-end">
          <button
            class="btn btn-sm btn-primary"
            onClick={onCreateDraft}
            title={
              hasDraftTree()
                ? "Create a new draft off the root"
                : "Attach a draft tree to this document"
            }
          >
            New draft
          </button>
        </div>
      </Show>
    </div>
  );
}

/** Placeholder shown when a host doc has no draft tree yet. Visually
 * matches a selected `DraftCard` so the layout doesn't pop when the user
 * clicks "New draft" and the real root materializes.
 */
function VirtualMainCard(props: { hostDocUrl: AutomergeUrl | undefined }) {
  return (
    <div
      class="text-left card card-bordered shadow-sm border bg-base-200 border-primary ring-1 ring-primary"
      title="Main version (host document)"
    >
      <div class="card-body p-2 space-y-1">
        <div class="text-sm font-medium flex items-center gap-2">
          <span>Main</span>
          <span class="badge badge-xs badge-primary">current</span>
        </div>
        <div class="text-xs text-gray-500 font-mono break-all">
          {props.hostDocUrl ?? ""}
        </div>
        <div class="text-xs text-gray-400">0 cloned doc(s) · 0 draft(s)</div>
      </div>
    </div>
  );
}

function DraftCard(props: {
  url: AutomergeUrl;
  isRoot: boolean;
  isSelected: boolean;
  onSelect: (url: AutomergeUrl) => void;
}) {
  const [doc] = useDocument<DraftDoc>(() => props.url);

  const cloneCount = createMemo(() => Object.keys(doc()?.clones ?? {}).length);
  const childCount = createMemo(() => doc()?.drafts.length ?? 0);

  return (
    <Show when={doc()}>
      <button
        type="button"
        class="text-left card card-bordered shadow-sm border hover:bg-gray-50"
        classList={{
          "bg-base-200 border-primary ring-1 ring-primary": props.isSelected,
          "bg-white border-gray-200": !props.isSelected,
        }}
        onClick={() => props.onSelect(props.url)}
        title={props.isRoot ? "Main version" : "Open draft"}
      >
        <div class="card-body p-2 space-y-1">
          <div class="text-sm font-medium flex items-center gap-2">
            <span>{props.isRoot ? "Main" : "Draft"}</span>
            <Show when={props.isSelected}>
              <span class="badge badge-xs badge-primary">current</span>
            </Show>
          </div>
          <div class="text-xs text-gray-500 font-mono break-all">
            {props.url}
          </div>
          <div class="text-xs text-gray-400">
            {cloneCount()} cloned doc(s) · {childCount()} draft(s)
          </div>
        </div>
      </button>
    </Show>
  );
}

// `DraftsState` is created by the draft-root provider only after it sees
// `@patchwork.draftUrl` appear on the host doc — so on first-create there
// is a brief window where `stateHandle()` is undefined. Poll briefly.
async function waitForState(
  stateHandle: () => DocHandle<DraftsState> | undefined,
  attempts = 50,
  intervalMs = 50
): Promise<DocHandle<DraftsState> | undefined> {
  for (let i = 0; i < attempts; i++) {
    const h = stateHandle();
    if (h) return h;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return undefined;
}
