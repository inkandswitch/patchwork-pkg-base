import type { AutomergeUrl, Repo } from "@automerge/automerge-repo/slim";
import { type Accessor, Show, createEffect } from "solid-js";
import { useDocument } from "solid-automerge";
import type { HasPatchworkMetadata } from "@inkandswitch/patchwork-filesystem";
import {
  useDocumentMetadata,
  useHistorySelection,
  useCachedHistory,
} from "../hooks";
import { type GroupingStrategyConfig, type HistoryItem, findItemForHeads } from "../../types";
import { DEFAULT_TIME_WINDOW } from "../utils";
import { DocHistoryHeader } from "./DocHistoryHeader";
import { HistoryList } from "./HistoryList";
import { HistoryComputingIndicator } from "./HistoryComputingIndicator";

export interface DocHistoryViewProps {
  url: AutomergeUrl;
  repo: Repo;
  /**
   * Whether to render the document's title in the header. Defaults to true;
   * pass an accessor returning `false` (e.g. when the sidebar is showing a
   * single doc whose title is already visible elsewhere) to suppress it
   * while keeping the reset button.
   */
  showTitle?: Accessor<boolean>;
  /**
   * A point in time to show: once the history has loaded, the item these
   * heads belong to is selected and scrolled into view. If no item ends at
   * those heads (they're older than anything grouped, or not in this doc),
   * nothing is selected.
   */
  focusHeads?: Accessor<readonly string[] | undefined>;
}

const STRATEGY_CONFIG: GroupingStrategyConfig = {
  name: "timeWindow",
  params: { timeWindow: DEFAULT_TIME_WINDOW },
};
const strategyConfig = () => STRATEGY_CONFIG;

export function DocHistoryView(props: DocHistoryViewProps) {
  const [doc, handle] = useDocument<HasPatchworkMetadata>(props.url, {
    repo: props.repo,
  });

  const { title } = useDocumentMetadata(doc);

  const { items: groupedItems, isInitializing, isRecalculating, forceRecompute, setLabel } = useCachedHistory(
    handle,
    strategyConfig,
    props.repo
  );

  const { selectedItems, selectItem, extendSelection, clearSelection } = useHistorySelection();

  const handleSelectItem = (item: HistoryItem, shiftHeld: boolean) => {
    if (shiftHeld) {
      extendSelection(item, groupedItems());
    } else {
      selectItem(item);
    }
  };

  // Focus the requested point in time once, when the items first contain it.
  let panel: HTMLDivElement | undefined;
  let focusedFor: string | undefined;
  createEffect(() => {
    const heads = props.focusHeads?.();
    if (!heads?.length || isInitializing()) return;
    const key = heads.join(",");
    if (key === focusedFor) return;
    const item = findItemForHeads(groupedItems(), heads);
    if (!item) return;
    focusedFor = key;
    selectItem(item);
    queueMicrotask(() =>
      panel
        ?.querySelector(`[data-latest-hash="${CSS.escape(item.latestHash)}"]`)
        ?.scrollIntoView({ block: "nearest" })
    );
  });

  return (
    <div ref={panel} class="history-panel" style={{ flex: "1", "min-height": "0" }} onClick={clearSelection}>
      <DocHistoryHeader
        title={(props.showTitle?.() ?? true) ? title() : undefined}
        onRecompute={forceRecompute}
        isRecalculating={isRecalculating()}
      />
      <Show
        when={!isInitializing()}
        fallback={<HistoryComputingIndicator />}
      >
        <HistoryList
          items={groupedItems()}
          selectedItems={selectedItems()}
          onSelectItem={handleSelectItem}
          onRenameItem={setLabel}
        />
      </Show>
    </div>
  );
}
