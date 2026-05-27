import "./styles.css";
import { createMemo, For, Show } from "solid-js";
import {
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-solid-primitives";
import type { AutomergeUrl } from "@automerge/automerge-repo";

import { requestDoc } from "@inkandswitch/patchwork-providers-solid";
import type { WorkspaceDoc, WorkspaceState } from "./workspace-types";

const VERSION = "v0.1.0";

export function DraftsSidebar(props: { element: HTMLElement }) {
  const repo = useRepo();
  const [root, rootHandle] = requestDoc<WorkspaceDoc>(
    props.element,
    "patchwork:workspace"
  );
  const [state, stateHandle] = requestDoc<WorkspaceState>(
    props.element,
    "patchwork:drafts"
  );

  const drafts = createMemo<AutomergeUrl[]>(() => state()?.drafts ?? []);
  const selected = createMemo<AutomergeUrl | undefined>(
    () => state()?.selectedDraft
  );

  const selectDraft = (url: AutomergeUrl) => {
    stateHandle()?.change((d) => {
      d.selectedDraft = url;
    });
  };

  const onCreate = () => {
    const r = rootHandle();
    if (!r) return;
    const child = repo.create<WorkspaceDoc>({
      "@patchwork": { type: "workspace" },
      parent: r.url,
      drafts: [],
      clones: {},
    });
    r.change((d) => {
      d.drafts.push(child.url);
    });
    selectDraft(child.url);
  };

  return (
    <div class="h-full flex flex-col p-2 gap-2">
      <div class="flex items-center justify-between text-xs text-gray-400">
        <span class="font-medium">Drafts</span>
        <span>{VERSION}</span>
      </div>

      <Show when={root()} fallback={<div class="text-xs text-gray-400">Loading workspace…</div>}>
        <div class="flex flex-col gap-1">
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
        </div>
      </Show>

      <div class="flex justify-end">
        <button
          class="btn btn-sm btn-primary"
          onClick={onCreate}
          disabled={!rootHandle()}
          title="Create a new draft off the root workspace"
        >
          New draft
        </button>
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
  const [doc] = useDocument<WorkspaceDoc>(() => props.url);

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
        title={props.isRoot ? "Root workspace" : "Open draft"}
      >
        <div class="card-body p-2 space-y-1">
          <div class="text-sm font-medium flex items-center gap-2">
            <span>{props.isRoot ? "Root" : "Draft"}</span>
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
