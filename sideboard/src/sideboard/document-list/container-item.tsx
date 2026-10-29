// A row for a doc that isn't a folder but has children (a directory doc's
// files, a branches doc's branches, whatever a package's path provider says;
// see container.ts). It opens up like a folder. Its children aren't entries in
// a folder: they open (at their path) and drag out, and can be renamed,
// removed or dropped among only as far as the provider offers. A dropped
// document is added (linked) and left where it was.
import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo/slim";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";
import type { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import { useDocument } from "solid-automerge";
import { createResource, createSignal, For, Match, Show, Switch, type JSX } from "solid-js";
import {
  containerChildren,
  providerOf,
  useExpandable,
  useProviderVersion,
  valueAt,
  type ContainerChild,
  type Provider,
} from "../container.ts";
import { isNewDocDrag } from "../dnd/dnd.ts";
import { getDndPayload, hasDocumentDrag } from "../dnd/payload.ts";
import { Chevron } from "../icons.tsx";
import { isSubUrl } from "../sub-url.ts";
import type { LivePathOf, OpenDetail } from "../live-path.ts";
import { setRenaming } from "../state.ts";
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

type Patchwork = { "@patchwork"?: { type?: string } };
const typeOf = (doc: unknown) => (doc as Patchwork | undefined)?.["@patchwork"]?.type;

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
    canRename?: boolean;
    canRemove?: boolean;
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
        canRename={props.canRename}
        canRemove={props.canRemove}
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
        <ContainerChildren {...props} names={names()} depth={props.depth + 1} />
      </Show>
    </div>
  );
}

function ContainerChildren(
  props: Shared & { url: AutomergeUrl; type: string; names: string[]; depth: number }
) {
  const [doc] = useDocument<object>(() => props.url, { repo: props.repo });
  // Providers go by type; re-asked when the type changes or a plugin is
  // registered, removed or reloaded, not on every edit.
  const version = useProviderVersion();
  const [provider] = createResource(
    () => (doc() ? `${typeOf(doc()) ?? ""}\u0000${version()}` : undefined),
    () => providerOf(doc())
  );
  const children = () => containerChildren(doc(), provider.latest);
  const expandable = useExpandable();

  /** Run one of the provider's edits on this container, at its current doc. */
  const edit =
    <A extends unknown[]>(
      method: "add" | "rename" | "remove",
      run: (p: Provider, handle: DocHandle<unknown>, node: unknown, ...args: A) => unknown
    ) =>
    async (...args: A) => {
      const p = provider.latest;
      if (!p?.[method]) return;
      try {
        const handle = await props.repo.find<unknown>(props.url);
        await run(p, handle, handle.doc(), ...args);
      } catch (error) {
        console.warn(`couldn't ${method} in ${props.url}`, error);
      }
    };
  const add = edit("add", (p, handle, node, child: { name: string; link: AutomergeUrl }) =>
    p.add!(handle, node, child)
  );
  const rename = edit("rename", (p, handle, node, name: string, to: string) =>
    p.rename!(handle, node, name, to)
  );
  const remove = edit("remove", (p, handle, node, name: string) => p.remove!(handle, node, name));

  // A document dragged here: the provider adds it, if it can. Files and new
  // documents are folder things, so they pass on by.
  const accepts = (event: DragEvent) =>
    !!provider.latest?.add && hasDocumentDrag(event.dataTransfer) && !isNewDocDrag(event);
  // A drop on a container inside another's children that doesn't take it
  // goes nowhere, rather than on to the container around it.
  const nested = (event: DragEvent) =>
    !!(event.currentTarget as HTMLElement).parentElement?.closest("[data-container-children]");

  return (
    <div
      role="group"
      class="document-list-folder__contents"
      data-depth={props.depth - 1}
      data-container-children=""
      data-provider-drop={provider.latest?.add ? "" : undefined}
      style={{ "--depth": props.depth }}
      ondragover={(event: DragEvent) => {
        if (!accepts(event)) {
          if (nested(event)) event.stopPropagation();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer!.dropEffect = "copy";
      }}
      ondrop={(event: DragEvent) => {
        if (!accepts(event)) {
          if (nested(event)) event.stopPropagation();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        for (const item of getDndPayload(event)?.items ?? []) {
          // Part of a document isn't something to link to: a walk wouldn't follow it.
          if (isSubUrl(item.url)) continue;
          void add({ name: item.name ?? item.url.slice("automerge:".length), link: item.url });
        }
      }}
    >
      <For each={children()}>
        {(child) => (
          <ChildRow
            {...props}
            child={child}
            containerDoc={doc()}
            containerType={props.type}
            expandable={expandable}
            canRename={!!provider.latest?.rename}
            canRemove={!!provider.latest?.remove}
            rename={(to) => rename(child.name, to)}
            remove={() => remove(child.name)}
          />
        )}
      </For>
    </div>
  );
}

/**
 * A child of a container: a linked document, which is itself a container if
 * it has children, or a value offered as a sub-document.
 */
function ChildRow(
  props: Shared & {
    url: AutomergeUrl;
    child: ContainerChild;
    containerDoc: unknown;
    /** The container's type: a sub-document of no type of its own opens with it. */
    containerType: string;
    names: string[];
    depth: number;
    expandable(type: string): boolean;
    canRename: boolean;
    canRemove: boolean;
    rename(to: string): void;
    remove(): void;
  }
) {
  const name = () => props.child.name;
  const link = () => ("url" in props.child ? props.child.url : undefined);
  const segments = () => ("sub" in props.child ? props.child.sub : undefined);

  const [linked] = useDocument<Patchwork & { docs?: unknown }>(link, { repo: props.repo });
  // A sub-document's url is its sub-handle's: automerge:<docId>/<path>. A host
  // whose automerge-repo has no sub-handles shows no sub-documents.
  const [subUrl] = createResource(
    () => segments(),
    async (sub) => {
      // An errored resource throws where it's read, so a failure is just no url.
      try {
        const handle = (await props.repo.find<unknown>(props.url)) as DocHandle<unknown> & {
          sub?(...segments: (string | number)[]): { url: AutomergeUrl };
        };
        return handle.sub?.(...sub).url;
      } catch {
        return undefined;
      }
    }
  );
  const url = () => link() ?? subUrl();
  const type = () => {
    const sub = segments();
    // A part of a document with no type of its own (a canvas's shape, say) is
    // its container's to show.
    if (sub) return typeOf(valueAt(props.containerDoc, sub)) ?? props.containerType;
    return typeOf(linked()) ?? (Array.isArray(linked()?.docs) ? "folder" : "");
  };

  const id = () => `${props.url}@${props.names.join("/")}/${name()}`;
  const startRenaming = () => {
    if (props.canRename) setRenaming(id());
  };
  const label = () => <ItemName name={name()} id={id()} rename={(to) => props.rename(to)} />;
  const open = (toolId?: string) =>
    props.open({
      url: url()!,
      toolId,
      title: name(),
      type: type(),
      path: props.livePathOf?.([...props.names, name()]),
    });

  return (
    <Show when={url()}>
      {(url) => (
        <Switch
          fallback={
            <Item
              aria-label={name()}
              id={id()}
              url={url()}
              name={name()}
              type={type()}
              pressed={props.isSelected(url())}
              readOnly
              canRename={props.canRename}
              canRemove={props.canRemove}
              element={props.element}
              repo={props.repo}
              rootFolderHandle={props.rootFolderHandle}
              startRenaming={startRenaming}
              remove={props.remove}
              openWith={open}
            >
              {label()}
            </Item>
          }
        >
          <Match when={link() && (type() === "folder" || props.expandable(type()))}>
            <ContainerItem
              {...props}
              url={url()}
              name={name()}
              id={id()}
              type={type()}
              readOnly
              canRename={props.canRename}
              canRemove={props.canRemove}
              startRenaming={startRenaming}
              remove={props.remove}
            >
              {label()}
            </ContainerItem>
          </Match>
        </Switch>
      )}
    </Show>
  );
}
