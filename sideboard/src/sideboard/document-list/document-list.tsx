import {
  deleteAt,
  updateText,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";
import type {
  OpenDocumentEventDetail,
  PatchworkViewElement,
} from "@inkandswitch/patchwork-elements";
import type {
  DocLink,
  FolderDoc,
  HasPatchworkMetadata,
} from "@inkandswitch/patchwork-filesystem";
import { getRegistry, isLoadedPlugin, type Datatype } from "@inkandswitch/patchwork-plugins";
import {
  createEffect,
  For,
  Match,
  onCleanup,
  Show,
  Suspense,
  Switch,
} from "solid-js";
import {
  filterMatches,
  setRenaming,
  pendingNewDoc,
  setPendingNewDoc,
} from "../state.ts";
import Folder from "./folder.tsx";
import Item from "./item.tsx";
import { ItemName } from "./name.tsx";
import { LoadingRow } from "./loading-row.tsx";
import { NewDocPlaceholder } from "../create-new.tsx";

export interface DocumentListProps {
  handle: DocHandle<FolderDoc>;
  docs?: DocLink[];
  depth: number;
  repo: Repo;
  open(detail: OpenDocumentEventDetail): void;
  selectedDocUrls: AutomergeUrl[];
  visitedFolders?: Set<AutomergeUrl>;
  element: PatchworkViewElement;
  rootFolderHandle: DocHandle<FolderDoc>;
  filter: string;
  clearFilter(): void;
}

export function DocumentList(props: DocumentListProps) {
  const visitedFolders = props.visitedFolders ?? new Set<AutomergeUrl>();

  function removeItem(index: number) {
    props.handle.change((folder) => deleteAt(folder.docs, index));
  }

  // True when a "new document" drag/click targeted this folder's list.
  const pendingHere = () =>
    !!props.handle && pendingNewDoc()?.containerUrl === props.handle.url;

  // Commit the pending placeholder: insert the freshly created doc at the drop
  // index, open it, and drop straight into rename mode.
  const commitPending = (docLink: DocLink) => {
    const target = pendingNewDoc();
    if (!target) return;
    const index = target.index;
    setPendingNewDoc(null);
    props.handle.change((folder) => folder.docs.splice(index, 0, docLink));
    props.open(docLink);
    setRenaming(props.handle.url + "/" + index);
  };

  const placeholder = () => (
    <div class="document-list__item document-list__item--visible">
      <NewDocPlaceholder
        repo={props.repo}
        onCreate={commitPending}
        onDismiss={() => setPendingNewDoc(null)}
        clearFilter={props.clearFilter}
      />
    </div>
  );

  return (
    <>
      <For each={props.docs}>
        {(doc, index) => {
          const visible = () =>
            !props.filter.length || filterMatches(props.filter, doc.name);
          const remove = () => removeItem(index());
          const relid = () => props.handle.url + "/" + index();
          const rename = (name: string) => {
            props.handle.change((doc) => {
              updateText(doc, ["docs", index(), "name"], name);
            });
            const datatypes = getRegistry<Datatype>("patchwork:datatype");
            props.repo
              .find<Partial<HasPatchworkMetadata>>(doc.url)
              .then(async (handle) => {
                const { "@patchwork": metadata } = handle.doc();

                if (metadata) {
                  const datatype = datatypes.get(metadata.type) as Datatype;

                  if (datatype) {
                    await datatypes.load(datatype.id);
                    handle.change((doc) =>
                      (datatype as any).module.setTitle?.(doc, name)
                    );
                  }
                }
              });
          };

          // Sync title from doc content → folder docref + @patchwork.title
          createEffect(() => {
            if (!props.selectedDocUrls.includes(doc.url)) return;

            let cancelled = false;
            let removeListener: (() => void) | undefined;

            props.repo
              .find<Partial<HasPatchworkMetadata>>(doc.url)
              .then(async (docHandle) => {
                if (cancelled) return;

                const datatypes = getRegistry<Datatype>("patchwork:datatype");

                async function syncTitle() {
                  const docData = docHandle.doc();
                  if (!docData) return;

                  const metadata = (docData as any)["@patchwork"];
                  if (!metadata?.type) return;

                  const datatype = datatypes.get(metadata.type) as Datatype;
                  if (!datatype) return;

                  await datatypes.load(datatype.id);
                  if (cancelled) return;
                  if (!isLoadedPlugin(datatype)) return;

                  const title = datatype.module.getTitle(docData);
                  if (!title) return;

                  // Update folder docref name if different
                  const currentFolder = props.handle.doc();
                  const currentName = currentFolder?.docs?.[index()]?.name;
                  if (currentName !== title) {
                    props.handle.change((folder) => {
                      updateText(folder, ["docs", index(), "name"], title);
                    });
                  }

                  // Set @patchwork.title on the doc if different
                  if (metadata.title !== title) {
                    docHandle.change((d: any) => {
                      if (d["@patchwork"]) {
                        d["@patchwork"].title = title;
                      }
                    });
                  }
                }

                await syncTitle();
                if (cancelled) return;

                const onChange = () => syncTitle();
                docHandle.on("change", onChange);
                removeListener = () => docHandle.off("change", onChange);
              });

            onCleanup(() => {
              cancelled = true;
              removeListener?.();
            });
          });

          return (
            <>
              <Show when={pendingHere() && pendingNewDoc()!.index === index()}>
                {placeholder()}
              </Show>
              <div
                classList={{
                  "document-list__item": true,
                  "document-list__item--visible": visible(),
                  "document-list__item--invisible": !visible(),
                }}
              >
                {/* Per-row boundary: a folder still loading its handle shows a
                    skeleton here without blocking its siblings. */}
                <Suspense fallback={<LoadingRow depth={props.depth} />}>
                <Switch>
                <Match when={doc.type == "folder"}>
                  <Show
                    when={!visitedFolders.has(doc.url)}
                    fallback={
                      <div
                        class="document-list-folder__circular-ref"
                        style={{ "padding-left": `calc(var(--depth) * 1rem)` }}
                      >
                        <span>{doc.name} (i contain myself eventually)</span>
                      </div>
                    }
                  >
                    <Folder
                      url={doc.url}
                      depth={props.depth}
                      repo={props.repo}
                      removeFromParent={remove}
                      parentFolderHandle={props.handle}
                      itemIndex={index()}
                      open={props.open}
                      name={doc.name}
                      selectedDocUrls={props.selectedDocUrls}
                      visitedFolders={visitedFolders}
                      element={props.element}
                      rootFolderHandle={props.rootFolderHandle}
                      filter={props.filter}
                      clearFilter={props.clearFilter}
                    />
                  </Show>
                </Match>
                <Match when={doc.type != "folder"}>
                  <Item
                    aria-label={doc.name}
                    url={doc.url}
                    name={doc.name}
                    id={relid()}
                    startRenaming={() => setRenaming(relid())}
                    remove={remove}
                    pressed={props.selectedDocUrls.includes(doc.url)}
                    type={doc.type}
                    element={props.element}
                    repo={props.repo}
                    rootFolderHandle={props.rootFolderHandle}
                    parentFolderHandle={props.handle}
                    itemIndex={index()}
                    openWith={(toolId) =>
                      props.open({
                        url: doc.url,
                        toolId,
                        title: doc.name,
                        type: doc.type,
                      })
                    }
                  >
                    <ItemName name={doc.name} id={relid()} rename={rename} />
                  </Item>
                </Match>
                </Switch>
                </Suspense>
              </div>
            </>
          );
        }}
      </For>
      <Show
        when={pendingHere() && pendingNewDoc()!.index >= (props.docs?.length ?? 0)}
      >
        {placeholder()}
      </Show>
  </>
  );
}
