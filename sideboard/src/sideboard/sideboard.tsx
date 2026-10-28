import { makeDocumentProjection } from "solid-automerge";
import { For, Show } from "solid-js";
import { render } from "solid-js/web";
import type { DocHandle, Repo } from "@automerge/automerge-repo/slim";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";

import type { PatchworkToolProps, SideboardAccountDoc } from "../types.ts";
import { DocumentListPanel } from "./document-list-panel.tsx";
import { LoadingRows } from "./document-list/loading-row.tsx";
import { AccountBar } from "./account-bar.tsx";
import { packagesFolders } from "./packages.ts";

/**
 * The combined sideboard: the document-list panel for the account's root folder,
 * a Packages section for each folder bound at `/packages` (installing is adding
 * a link there), and the account bar pinned below. Reads the account document.
 */
export function Sideboard(props: PatchworkToolProps<SideboardAccountDoc>) {
  const doc = makeDocumentProjection(props.handle);

  return (
    <div class="sideboard">
      <Show
        when={doc.rootFolderUrl}
        fallback={
          <aside class="document-list">
            <nav class="document-list__doclist document-list-widget">
              <LoadingRows depth={0} />
            </nav>
          </aside>
        }
      >
        <DocumentListPanel
          folderUrl={doc.rootFolderUrl!}
          repo={props.repo}
          element={props.element}
        />
      </Show>
      <For each={packagesFolders(doc)}>
        {(folderUrl) => (
          <DocumentListPanel
            folderUrl={folderUrl}
            repo={props.repo}
            element={props.element}
            heading="Packages"
            toolbar={false}
          />
        )}
      </For>
      <AccountBar
        handle={props.handle}
        repo={props.repo}
        element={props.element}
      />
    </div>
  );
}

// Kept here (rather than index.tsx) so the entry point never statically
// imports solid-js/web — the sideboard shouldn't load Solid until it's
// actually mounted.
export function renderSideboard(
  handle: DocHandle<SideboardAccountDoc>,
  element: PatchworkViewElement & { repo: Repo }
) {
  return render(
    () => <Sideboard handle={handle} repo={element.repo} element={element} />,
    element
  );
}
