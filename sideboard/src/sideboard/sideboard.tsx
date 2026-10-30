import { makeDocumentProjection } from "solid-automerge";
import { For, Show } from "solid-js";
import { render } from "solid-js/web";
import type { DocHandle, Repo } from "@automerge/automerge-repo/slim";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";

import type { PatchworkToolProps, SideboardAccountDoc } from "../types.ts";
import { DocumentListPanel } from "./document-list-panel.tsx";
import { LoadingRows } from "./document-list/loading-row.tsx";
import { AccountBar } from "./account-bar.tsx";
import { rootFolders } from "./packages.ts";

/**
 * The combined sideboard: a document-list panel for each folder bound at `/`
 * (the account's root folder, unless `/` is bound elsewhere), with the account
 * bar pinned below them. Reads the account document. `/packages` shows in the
 * root folder as a `packages` folder.
 */
export function Sideboard(props: PatchworkToolProps<SideboardAccountDoc>) {
  const doc = makeDocumentProjection(props.handle);

  return (
    <div class="sideboard">
      <Show
        when={rootFolders(doc).length}
        fallback={
          <aside class="document-list">
            <nav class="document-list__doclist document-list-widget">
              <LoadingRows depth={0} />
            </nav>
          </aside>
        }
      >
        <For each={rootFolders(doc)}>
          {(folderUrl) => (
            <DocumentListPanel
              folderUrl={folderUrl}
              repo={props.repo}
              element={props.element}
            />
          )}
        </For>
      </Show>
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
