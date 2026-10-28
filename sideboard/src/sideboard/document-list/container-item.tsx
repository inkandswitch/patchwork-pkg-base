// A row for a doc that isn't a folder but has children (a directory doc's
// files, a branches doc's branches; see container.ts). It opens up like a
// folder. Its children aren't entries in a folder, so they're read-only: they
// open (at their path) and drag out, but can't be renamed, removed or dropped on.
import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo/slim";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";
import type { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import { useDocument } from "solid-automerge";
import { createSignal, For, Show, type JSX } from "solid-js";
import { canExpand, containerChildren } from "../container.ts";
import { Chevron } from "../icons.tsx";
import type { LivePathOf, OpenDetail } from "../live-path.ts";
import Item from "./item.tsx";
import { ItemName } from "./name.tsx";

type Shared = {
  repo: Repo;
  element: PatchworkViewElement;
  rootFolderHandle: DocHandle<FolderDoc>;
  open(detail: OpenDetail): void;
  isSelected(url: AutomergeUrl): boolean;
  livePathOf?: LivePathOf;
};

export function ContainerItem(
  props: Shared & {
    url: AutomergeUrl;
    name: string;
    type: string;
    id: string;
    depth: number;
    /** The names walked to this row's parent, for live paths. */
    names: string[];
    readOnly?: boolean;
    parentFolderHandle?: DocHandle<FolderDoc>;
    itemIndex?: number;
    startRenaming(): void;
    remove(): void;
    /** The row's label (a name, renameable or not). */
    children: JSX.Element;
  }
) {
  const [expanded, setExpanded] = createSignal(false);
  const names = () => [...props.names, String(props.name)];
  const toggle = () => setExpanded((yn) => !yn);

  return (
    <div
      class="document-list-folder"
      role="none"
      data-depth={props.depth}
      style={{ "--depth": props.depth }}
    >
      <Item
        aria-label={props.name}
        id={props.id}
        url={props.url}
        name={props.name}
        type={props.type}
        pressed={props.isSelected(props.url)}
        readOnly={props.readOnly}
        element={props.element}
        repo={props.repo}
        rootFolderHandle={props.rootFolderHandle}
        parentFolderHandle={props.parentFolderHandle}
        itemIndex={props.itemIndex}
        isExpanded={expanded()}
        onToggleExpand={toggle}
        startRenaming={props.startRenaming}
        remove={props.remove}
        openWith={(toolId) =>
          props.open({
            url: props.url,
            toolId,
            title: props.name,
            type: props.type,
            path: props.livePathOf?.(names()),
          })
        }
      >
        <span
          aria-hidden="true"
          class="document-list-folder__toggle"
          on:click={(event: MouseEvent) => {
            event.stopImmediatePropagation();
            toggle();
          }}
        >
          <Show when={expanded()} fallback={<Chevron />}>
            <Chevron style={{ rotate: "90deg" }} />
          </Show>
        </span>
        {props.children}
      </Item>
      {/* Mounted only when open, so a collapsed package loads nothing. */}
      <Show when={expanded()}>
        <div
          role="group"
          class="document-list-folder__contents"
          data-depth={props.depth}
          style={{ "--depth": props.depth + 1 }}
        >
          <ContainerChildren {...props} names={names()} depth={props.depth + 1} />
        </div>
      </Show>
    </div>
  );
}

function ContainerChildren(
  props: Shared & { url: AutomergeUrl; names: string[]; depth: number }
) {
  const [doc] = useDocument<object>(() => props.url, { repo: props.repo });
  return (
    <For each={containerChildren(doc())}>
      {(child) => <ChildRow {...props} url={child.url} name={child.name} />}
    </For>
  );
}

/** A child of a container: read-only, and itself a container if it has children. */
function ChildRow(
  props: Shared & { url: AutomergeUrl; name: string; names: string[]; depth: number }
) {
  const [doc] = useDocument<{ "@patchwork"?: { type?: string }; docs?: unknown }>(
    () => props.url,
    { repo: props.repo }
  );
  const type = () =>
    doc()?.["@patchwork"]?.type ?? (Array.isArray(doc()?.docs) ? "folder" : "");
  const id = () => `${props.url}@${props.names.join("/")}/${props.name}`;
  const noop = () => {};
  const label = <ItemName name={props.name} id={id()} rename={noop} />;

  return (
    <Show
      when={type() === "folder" || canExpand(type())}
      fallback={
        <Item
          aria-label={props.name}
          id={id()}
          url={props.url}
          name={props.name}
          type={type()}
          pressed={props.isSelected(props.url)}
          readOnly
          element={props.element}
          repo={props.repo}
          rootFolderHandle={props.rootFolderHandle}
          startRenaming={noop}
          remove={noop}
          openWith={(toolId) =>
            props.open({
              url: props.url,
              toolId,
              title: props.name,
              type: type(),
              path: props.livePathOf?.([...props.names, props.name]),
            })
          }
        >
          {label}
        </Item>
      }
    >
      <ContainerItem
        {...props}
        id={id()}
        type={type()}
        readOnly
        startRenaming={noop}
        remove={noop}
      >
        {label}
      </ContainerItem>
    </Show>
  );
}
