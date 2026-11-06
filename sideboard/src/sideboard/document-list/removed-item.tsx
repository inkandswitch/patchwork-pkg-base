import { filterMatches } from "../state.ts";
import type { Open } from "../events.ts";
import { ChangeDot, type RemovedEntry } from "./draft-overlay.tsx";

// A doc that was in this folder at its diff baseline and isn't any more. It
// opens read-only, at the version it's at now, through the folder as it was
// when it still listed it.
export function RemovedItem(props: {
  entry: RemovedEntry;
  open: Open;
  filter: string;
}) {
  const visible = () =>
    !props.filter.length || filterMatches(props.filter, props.entry.name);
  const open = () =>
    props.open({
      url: props.entry.url,
      path: [props.entry.folder],
      title: props.entry.name,
      type: props.entry.type,
    });

  return (
    <div
      classList={{
        "document-list__item": true,
        "document-list__item--visible": visible(),
        "document-list__item--invisible": !visible(),
      }}
    >
      <div
        role="treeitem"
        tabindex="-1"
        aria-label={`${props.entry.name} (removed)`}
        class="document-list-item document-list-item--removed"
        on:click={open}
        onkeydown={(event: KeyboardEvent) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          open();
        }}
      >
        <span class="document-list-item__name">{props.entry.name}</span>
        <ChangeDot change="removed" />
      </div>
    </div>
  );
}
