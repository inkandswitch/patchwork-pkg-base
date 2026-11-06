/**
 * `DocumentAreaRoot` — the threepane document column (draft scope + top bar +
 * main view + context sidebar), extracted so it can run either directly in the
 * host (`threepane`) or as an isolated `patchwork:component` inside the iframe
 * (`threepane-isolation`).
 *
 * It takes Accessor-shaped props uniformly: the local caller passes its reactive
 * accessors; the isolated caller (the mount fn in `isolation-entry.tsx`) wraps
 * parsed-JSON values in constant accessors, which is correct because any real
 * change to the boot spec reboots the iframe.
 *
 * The right-sidebar collapse/width state, its resize handlers, and the selected
 * context-tab signal live HERE (not threaded from the host), so they survive
 * inside the isolation boundary. The left sidebar is host-side; this component
 * only reads `isLeftCollapsed` for top-bar layout.
 */

import { type AutomergeUrl } from "@automerge/automerge-repo/slim";
import { subscribe } from "@inkandswitch/patchwork-providers";
import { makePersisted } from "@solid-primitives/storage";
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
  type Accessor,
} from "solid-js";
import type { ToolSlot } from "../types";
import {
  useProviderReady,
  useTaggedComponents,
  SIDEBAR_KEYS,
  COLLAPSE_CONTEXT_SIDEBAR_EVENT,
} from "../hooks";
import { useSidebarResize } from "../hooks/useSidebarResize";
import { FrameTopBar } from "./FrameTopBar";
import { ContextSidebar } from "./ContextSidebar";
import { MainDocumentView } from "./MainDocumentView";

/**
 * The reactive inputs the document area needs, shared by both the local caller
 * (`PatchworkFrame` → `DocumentAreaRoot`) and the isolated caller
 * (`IsolatedDocumentArea`, which forwards them into the boot spec). The host
 * owns these — including reading the right-sidebar seeds from localStorage — so
 * both paths receive an identical contract.
 */
export interface DocumentAreaInputs {
  selectedDocUrl: Accessor<AutomergeUrl | undefined>;
  selectedToolId: Accessor<string | undefined>;
  doctitleSlots: Accessor<ToolSlot[] | undefined>;
  /** The host-side left sidebar's collapsed state, for top-bar layout only. */
  isLeftCollapsed: Accessor<boolean>;
  /** Seed values for the document-area-local right-sidebar state. */
  initialRightWidth: Accessor<number>;
  initialRightCollapsed: Accessor<boolean>;
}

export interface DocumentAreaRootProps extends DocumentAreaInputs {
  /**
   * Host-realm ref set when the main document view mounts, used by the host to
   * flip its left-sidebar `widgetsReady` gate. Only supplied in the local
   * (non-isolated) path; inside the iframe it stays undefined (that realm can't
   * drive the host's signal), which is correct.
   */
  setMainDocElement?: (el: HTMLElement) => void;
  /**
   * Set when an ancestor `patchwork-workspace-provider` can say which
   * workspace the selected doc belongs to. Drafts are then scoped to that
   * workspace, and the checked-out draft is remembered in `accountDocUrl`.
   * Inside the isolation iframe there is no such ancestor, so drafts stay
   * scoped to the document.
   */
  workspaceScoped?: boolean;
  accountDocUrl?: AutomergeUrl;
}

// What `patchwork-workspace-provider` answers for the selected doc.
type WorkspaceRoot = {
  docUrl: string;
  rootUrl: AutomergeUrl;
};

type DraftScope = { docUrl: AutomergeUrl; rootUrl: AutomergeUrl };

export function DocumentAreaRoot(props: DocumentAreaRootProps) {
  // ── Right-sidebar state (document-area-local) ──────────────────
  // Lives here so it survives inside the isolation boundary. Seeded from props
  // (the host reads persisted values from its localStorage and passes them in,
  // since localStorage is stubbed inside the sandboxed iframe). Persisted back
  // to localStorage when host-side; a harmless no-op inside the iframe.
  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = createSignal(
    props.initialRightCollapsed()
  );
  const [rightSidebarWidth, setRightSidebarWidth] = createSignal(
    props.initialRightWidth()
  );

  createEffect(
    on(
      isRightSidebarCollapsed,
      (value) => {
        try {
          localStorage.setItem(SIDEBAR_KEYS.rightCollapsed, String(value));
        } catch {
          /* localStorage stubbed inside the iframe */
        }
      },
      { defer: true }
    )
  );
  createEffect(
    on(
      rightSidebarWidth,
      (value) => {
        try {
          localStorage.setItem(SIDEBAR_KEYS.rightWidth, String(value));
        } catch {
          /* localStorage stubbed inside the iframe */
        }
      },
      { defer: true }
    )
  );

  const sidebarResize = useSidebarResize("right", {
    isCollapsed: isRightSidebarCollapsed,
    setCollapsed: setIsRightSidebarCollapsed,
    setWidth: setRightSidebarWidth,
  });

  // The host collapses the left sidebar directly, but the right-sidebar collapse
  // state lives here, so it asks us to collapse out-of-band via a window event
  // (e.g. after a finger-tap opens a document in the left sidebar — see
  // `FrameLayout`). Only wired on the host (non-isolated) path; the sandboxed
  // iframe realm never receives the host's window events.
  onMount(() => {
    const onCollapse = () => setIsRightSidebarCollapsed(true);
    window.addEventListener(COLLAPSE_CONTEXT_SIDEBAR_EVENT, onCollapse);
    onCleanup(() =>
      window.removeEventListener(COLLAPSE_CONTEXT_SIDEBAR_EVENT, onCollapse)
    );
  });

  // Selected context-sidebar tab, lifted above the per-draft remount boundary so
  // the active tab survives branch switches even though its content remounts.
  const [selectedContextToolId, setSelectedContextToolId] = makePersisted(
    createSignal<string | undefined>(),
    { name: SIDEBAR_KEYS.contextToolId }
  );

  // The selected doc and the root its drafts hang off. Only an answer for
  // the doc that's selected *now* counts: until it arrives the previous doc
  // stays up, so a doc is never shown under another root's drafts.
  let anchor!: HTMLDivElement;
  const [workspaceRoot, setWorkspaceRoot] = createSignal<WorkspaceRoot | null>(
    null
  );
  onMount(() => {
    if (!props.workspaceScoped) return;
    onCleanup(
      subscribe<WorkspaceRoot>(anchor, { type: "workspace:root" }, (root) =>
        setWorkspaceRoot(root)
      )
    );
  });
  const scope = createMemo<DraftScope | undefined>(
    (previous) => {
      const docUrl = props.selectedDocUrl();
      if (!docUrl) return undefined;
      if (!props.workspaceScoped) return { docUrl, rootUrl: docUrl };
      const root = workspaceRoot();
      return root?.docUrl === docUrl
        ? { docUrl, rootUrl: root.rootUrl }
        : previous;
    },
    undefined,
    {
      equals: (a, b) => a?.docUrl === b?.docUrl && a?.rootUrl === b?.rootUrl,
    }
  );
  const rootUrl = createMemo(() => scope()?.rootUrl);

  // Keyed on the root alone: the draft provider reads its attributes once at
  // mount (attribute changes are ignored while a `component` attribute is
  // set), so a new root needs a new provider, while moving between docs of
  // one workspace keeps it, with its checkout and draft list.
  return (
    <div ref={anchor} style={{ display: "contents" }}>
      <Show when={rootUrl()} keyed>
        {(root) => (
          <DraftDocumentArea
            rootUrl={root}
            accountDocUrl={props.accountDocUrl}
            setMainDocElement={props.setMainDocElement}
            selectedDocUrl={() => scope()?.docUrl}
            selectedToolId={props.selectedToolId}
            doctitleSlots={props.doctitleSlots}
            isLeftCollapsed={props.isLeftCollapsed}
            isRightSidebarCollapsed={isRightSidebarCollapsed}
            setIsRightSidebarCollapsed={setIsRightSidebarCollapsed}
            rightSidebarWidth={rightSidebarWidth}
            handleMouseDown={sidebarResize.handleMouseDown}
            handleToggleClick={sidebarResize.handleToggleClick}
            selectedContextToolId={selectedContextToolId}
            setSelectedContextToolId={setSelectedContextToolId}
          />
        )}
      </Show>
    </div>
  );
}

// Renders the main document inside the draft provider for its root. The
// provider follows the checked-out draft itself, re-pointing live document
// handles in place — so neither a draft switch nor a history checkpoint move
// remounts anything here. Checkpoint pins live in the provider's repo, which
// re-points each handle at the pinned heads (see `DraftRepo`), so the doc url
// the view is keyed on stays stable while scrubbing.
//
// The comments + focus providers and the context (right) sidebar live *inside*
// the draft provider so that, on a draft, comment threads / selection resolve
// against the draft's clone. The document toolbar (top bar) is in that scope
// too — it targets the same selected doc as the editor.
function DraftDocumentArea(props: {
  rootUrl: AutomergeUrl;
  accountDocUrl?: AutomergeUrl;
  setMainDocElement?: (el: HTMLElement) => void;
  selectedDocUrl: Accessor<AutomergeUrl | undefined>;
  selectedToolId: Accessor<string | undefined>;
  doctitleSlots: Accessor<ToolSlot[] | undefined>;
  isLeftCollapsed: Accessor<boolean>;
  isRightSidebarCollapsed: Accessor<boolean>;
  setIsRightSidebarCollapsed: (
    value: boolean | ((prev: boolean) => boolean)
  ) => void;
  rightSidebarWidth: Accessor<number>;
  handleMouseDown: (e: MouseEvent) => void;
  handleToggleClick: (e: MouseEvent) => void;
  selectedContextToolId: Accessor<string | undefined>;
  setSelectedContextToolId: (id: string) => void;
}) {
  // The context sidebar exists only if something is tagged `context-tool`.
  const contextItems = useTaggedComponents("context-tool");
  const hasContext = () => contextItems().length > 0;

  // Remount key for the main view: just the selected doc. The draft repo
  // swaps handle backings in place for checkpoint pins, so scrubbing history
  // must not change this key. Stamping heads here would also override the
  // pin: in `DraftRepo`, heads on the requested url win over the checkpoint's.
  const mainViewKey = createMemo<string | undefined>(() =>
    props.selectedDocUrl()
  );

  const [draftProviderHost, setDraftProviderHost] =
    createSignal<HTMLElement>();
  const isDraftProviderReady = useProviderReady(
    "patchwork-draft-provider",
    draftProviderHost
  );

  const [commentsProviderElement, setCommentsProviderElement] =
    createSignal<HTMLElement>();
  const isCommentsProviderReady = useProviderReady(
    "patchwork-comments-provider",
    commentsProviderElement
  );

  const [focusProviderElement, setFocusProviderElement] =
    createSignal<HTMLElement>();
  const isFocusProviderReady = useProviderReady(
    "patchwork-focus-provider",
    focusProviderElement
  );

  const areDocProvidersReady = createMemo(
    () =>
      isDraftProviderReady() &&
      isCommentsProviderReady() &&
      isFocusProviderReady()
  );

  return (
    <patchwork-view
      component="patchwork-draft-provider"
      doc-url={props.rootUrl}
      attr:account-url={props.accountDocUrl}
      ref={setDraftProviderHost}
    >
      <patchwork-view
        component="patchwork-comments-provider"
        ref={setCommentsProviderElement}
      >
        <patchwork-view
          component="patchwork-focus-provider"
          ref={setFocusProviderElement}
        >
          <Show when={areDocProvidersReady()}>
            <div class="frame__main-column">
              <div class="frame__doc-column">
                <FrameTopBar
                  docUrl={props.selectedDocUrl}
                  toolSlots={props.doctitleSlots}
                  isLeftCollapsed={props.isLeftCollapsed}
                  hasContext={hasContext}
                  isRightCollapsed={props.isRightSidebarCollapsed}
                  onToggleRight={() =>
                    props.setIsRightSidebarCollapsed((v) => !v)
                  }
                />

                <div class="main-area">
                  <MainDocumentView
                    viewKey={mainViewKey}
                    selectedDocUrl={props.selectedDocUrl}
                    toolId={props.selectedToolId}
                    // Always pass a function ref. Passing `ref={undefined}`
                    // (the isolated path, where no host ref is threaded)
                    // makes Solid's component-ref codegen fall back to
                    // assigning the prop, which throws on the getter-only
                    // reactive props object. A no-op wrapper avoids that.
                    ref={(el) => props.setMainDocElement?.(el)}
                  />
                </div>
              </div>

              <Show when={hasContext()}>
                <ContextSidebar
                  selectedToolId={props.selectedContextToolId}
                  setSelectedToolId={props.setSelectedContextToolId}
                  isCollapsed={props.isRightSidebarCollapsed}
                  width={props.rightSidebarWidth}
                  onMouseDown={props.handleMouseDown}
                  onToggleClick={props.handleToggleClick}
                  onCollapse={() => props.setIsRightSidebarCollapsed(true)}
                />
              </Show>
            </div>
          </Show>
        </patchwork-view>
      </patchwork-view>
    </patchwork-view>
  );
}
