import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { For, Show } from "solid-js";
import { parseAutomergeUrl, type DocHandle, type Repo } from "@automerge/automerge-repo/slim";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";
import type { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import {
  useSupportedToolsForType,
  useFilteredDatatypes,
} from "../lib/solid-plugins";
import { dragstack, clearDragstack } from "../dnd/dnd.ts";
import { removeItemsByUrl } from "../dnd/operations.ts";
import { menuTarget, setMenuTarget, type MenuTarget } from "../state.ts";

/**
 * The one context menu shared by every row in a panel. A row opens it by
 * setting `menuTarget` (see item.tsx); the menu is anchored at the pointer
 * position it was opened from and its contents are built for that row.
 */
export function ItemMenu(props: {
  repo: Repo;
  rootFolderHandle: DocHandle<FolderDoc>;
  element: PatchworkViewElement;
}) {
  const target = () => {
    const t = menuTarget();
    return t && props.element.contains(t.element) ? t : null;
  };

  function close() {
    const t = target();
    if (!t) return;
    setMenuTarget(null);
    t.element.focus({ preventScroll: true });
  }

  return (
    <DropdownMenu
      open={!!target()}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      getAnchorRect={() => {
        const t = target();
        return t ? { x: t.x, y: t.y } : undefined;
      }}
      placement="right-start"
      gutter={2}
      shift={2}
    >
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="popmenu__content">
          <Show when={target()} keyed>
            {(t) => (
              <MenuItems
                target={t}
                repo={props.repo}
                rootFolderHandle={props.rootFolderHandle}
              />
            )}
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}

function MenuItems(props: {
  target: MenuTarget;
  repo: Repo;
  rootFolderHandle: DocHandle<FolderDoc>;
}) {
  const t = props.target;
  const tools = useSupportedToolsForType(t.type);
  const datatypes = useFilteredDatatypes((item) => !item.unlisted);
  const multi = () => dragstack.has(t.id) && dragstack.size > 1;
  const patchworkUrl = () =>
    `${location.protocol}//${location.host}/#doc=${parseAutomergeUrl(t.url).documentId}`;

  // Remove from the context menu. When this item is part of a multi-selection
  // (cmd-click or cmd-drag marquee), remove the whole selection — with a
  // confirmation prompt, since removing several at once is easy to fat-finger.
  // A lone item removes without a prompt, matching the old behaviour.
  async function handleRemove() {
    if (!multi()) {
      t.remove();
      return;
    }
    const urls = [...dragstack.values()].map((item) => item.url);
    if (!confirm(`Remove ${urls.length} items from the sidebar?`)) return;
    clearDragstack();
    await removeItemsByUrl(props.repo, props.rootFolderHandle, urls);
  }

  return (
    <>
      <Show when={t.createInside}>
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger class="popmenu__sub-trigger">
            Create
          </DropdownMenu.SubTrigger>
          <DropdownMenu.Portal>
            <DropdownMenu.SubContent class="popmenu__sub-content">
              <For each={datatypes}>
                {(datatype) => (
                  <DropdownMenu.Item
                    class="popmenu__item"
                    onSelect={() => t.createInside!(datatype)}
                  >
                    {datatype.name}
                  </DropdownMenu.Item>
                )}
              </For>
            </DropdownMenu.SubContent>
          </DropdownMenu.Portal>
        </DropdownMenu.Sub>
      </Show>
      <Show when={tools.length}>
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger class="popmenu__sub-trigger">
            Open with...
          </DropdownMenu.SubTrigger>
          <DropdownMenu.Portal>
            <DropdownMenu.SubContent class="popmenu__sub-content">
              <For each={tools}>
                {(tool) => (
                  <DropdownMenu.Item
                    class="popmenu__item"
                    onSelect={() => t.openWith(tool.id)}
                  >
                    {tool.name}
                  </DropdownMenu.Item>
                )}
              </For>
            </DropdownMenu.SubContent>
          </DropdownMenu.Portal>
        </DropdownMenu.Sub>
      </Show>
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger class="popmenu__sub-trigger">
          Copy
        </DropdownMenu.SubTrigger>
        <DropdownMenu.Portal>
          <DropdownMenu.SubContent class="popmenu__sub-content">
            <DropdownMenu.Item
              class="popmenu__item"
              onSelect={() => navigator.clipboard.writeText(t.url)}
            >
              Automerge url
            </DropdownMenu.Item>
            <DropdownMenu.Item
              class="popmenu__item"
              onSelect={() => navigator.clipboard.writeText(patchworkUrl())}
            >
              Patchwork url
            </DropdownMenu.Item>
            <Show when={tools.length}>
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger class="popmenu__sub-trigger">
                  Patchwork url with...
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent class="popmenu__sub-content">
                    <For each={tools}>
                      {(tool) => (
                        <DropdownMenu.Item
                          class="popmenu__item"
                          onSelect={() =>
                            navigator.clipboard.writeText(
                              `${patchworkUrl()}&tool=${tool.id}`
                            )
                          }
                        >
                          {tool.name}
                        </DropdownMenu.Item>
                      )}
                    </For>
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            </Show>
          </DropdownMenu.SubContent>
        </DropdownMenu.Portal>
      </DropdownMenu.Sub>
      <DropdownMenu.Item class="popmenu__item" onSelect={() => t.startRenaming()}>
        Rename
      </DropdownMenu.Item>
      <DropdownMenu.Item class="popmenu__item" onSelect={handleRemove}>
        {multi() ? `Remove ${dragstack.size} items` : "Remove"}
      </DropdownMenu.Item>
    </>
  );
}
