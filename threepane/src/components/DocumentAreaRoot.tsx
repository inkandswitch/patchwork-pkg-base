/**
 * `DocumentAreaRoot` — the threepane document column (draft scope + top bar +
 * main view + context sidebar), on its own so it can render inline in the frame
 * or be mounted by a host as the `threepane-document-area` component (see
 * HostedDocumentArea.tsx).
 *
 * It takes Accessor-shaped props uniformly: the inline caller passes its
 * reactive accessors; `mountDocumentArea` passes accessors over a store it
 * re-reads from the props script.
 *
 * The right-sidebar collapse/width state, its resize handlers, and the selected
 * context-tab signal live HERE (not threaded from the frame), so they go
 * wherever the document area is mounted. The left sidebar stays in the frame;
 * this component only reads `isLeftCollapsed` for top-bar layout.
 */

import { type AutomergeUrl } from "@automerge/automerge-repo/slim";
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
  type JSX,
} from "solid-js";
import type { ContextLaneConfig, ToolSlot } from "../types";
import { useContextLane } from "../hooks/useContextLane";
import {
  useProviderReady,
  useTaggedComponents,
  SIDEBAR_KEYS,
  COLLAPSE_CONTEXT_SIDEBAR_EVENT,
} from "../hooks";
import { useSidebarResize } from "../hooks/useSidebarResize";
import { FrameTopBar } from "./FrameTopBar";
import { ContextSidebar } from "./ContextSidebar";
import { CommentsOpener } from "./CommentsOpener";
import { CallVideoOpener } from "./CallVideoOpener";
import { MainDocumentView } from "./MainDocumentView";

/**
 * The reactive inputs the document area needs, shared by the inline caller
 * (`PatchworkFrame` → `DocumentAreaRoot`) and the hosted one
 * (`HostedDocumentArea`, which serializes them into the props script). The
 * frame owns these — including reading the right-sidebar seeds from
 * localStorage — so both receive an identical contract.
 */
export interface DocumentAreaInputs {
  selectedDocUrl: Accessor<AutomergeUrl | undefined>;
  selectedToolId: Accessor<string | undefined>;
  doctitleSlots: Accessor<ToolSlot[] | undefined>;
  /** Doctitle tool ids hidden from the top bar. */
  doctitleHidden: Accessor<string[] | undefined>;
  /** The person's edits to the context tabs. */
  contextLane: Accessor<ContextLaneConfig | undefined>;
  /** The host-side left sidebar's collapsed state, for top-bar layout only. */
  isLeftCollapsed: Accessor<boolean>;
  /** Seed values for the document-area-local right-sidebar state. */
  initialRightWidth: Accessor<number>;
  initialRightCollapsed: Accessor<boolean>;
}

export interface DocumentAreaRootProps extends DocumentAreaInputs {
  /**
   * Ref set when the main document view mounts, used by the frame to flip its
   * left-sidebar `widgetsReady` gate. Only supplied inline; a hosted document
   * area leaves it undefined, which is correct.
   */
  setMainDocElement?: (el: HTMLElement) => void;
}

export function DocumentAreaRoot(props: DocumentAreaRootProps) {
  // ── Right-sidebar state (document-area-local) ──────────────────
  // Lives here so it goes wherever the document area is mounted. Seeded from props
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
  // `FrameLayout`). Only reaches an inline document area; a hosted one in
  // another realm never receives the frame's window events.
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

  // Per-document draft scope. Keyed on the selected doc URL so the whole draft
  // tree remounts when the user switches docs: the draft-state provider reads
  // its `doc-url` attribute once at mount (attribute changes are ignored while
  // a `component` attribute is set), so it cannot re-point in place.
  const [draftStateProviderHost, setDraftStateProviderHost] =
    createSignal<HTMLElement>();
  const isDraftStateProviderReady = useProviderReady(
    "patchwork-draft-state-provider",
    draftStateProviderHost
  );
  const readyDraftStateHost = () =>
    isDraftStateProviderReady() ? draftStateProviderHost() : undefined;

  return (
    <>
      {/* above the per-document remount, so a doc switch doesn't drop it */}
      <CallVideoOpener
        selected={selectedContextToolId}
        select={setSelectedContextToolId}
        isCollapsed={isRightSidebarCollapsed}
        open={(toolId) => {
          setSelectedContextToolId(toolId);
          setIsRightSidebarCollapsed(false);
        }}
      />
      <Show when={props.selectedDocUrl()} keyed>
        {(docUrl) => (
          <patchwork-view
            component="patchwork-draft-state-provider"
            doc-url={docUrl}
            ref={setDraftStateProviderHost}
          >
            <Show when={readyDraftStateHost()}>
              {(host) => (
                <DraftDocumentArea
                  host={host()}
                  setMainDocElement={props.setMainDocElement}
                  selectedDocUrl={props.selectedDocUrl}
                  selectedToolId={props.selectedToolId}
                  doctitleSlots={props.doctitleSlots}
                  doctitleHidden={props.doctitleHidden}
                  contextLane={props.contextLane}
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
          </patchwork-view>
        )}
      </Show>
    </>
  );
}

// Renders the main document inside the draft-overlay provider. The provider
// mounts once and follows the checked-out draft itself (via the draft-state
// provider's `draft:checked-out` doc), re-pointing live document handles in
// place — so neither a draft switch nor a history checkpoint move remounts
// anything here. Checkpoint pins travel on the *backing* url inside the
// streamed `repo:handle-descriptor` answers (see `DraftOverlayProvider`), so
// the presented doc url the view is keyed on stays stable while scrubbing.
//
// The comments + focus providers and the context (right) sidebar live *inside*
// the overlay so that, on a draft, comment threads / selection resolve against
// the draft's clone. The document toolbar (top bar) is in that scope too — it
// targets the same selected doc as the editor.
function DraftDocumentArea(props: {
  host: HTMLElement;
  setMainDocElement?: (el: HTMLElement) => void;
  selectedDocUrl: Accessor<AutomergeUrl | undefined>;
  selectedToolId: Accessor<string | undefined>;
  doctitleSlots: Accessor<ToolSlot[] | undefined>;
  doctitleHidden: Accessor<string[] | undefined>;
  contextLane: Accessor<ContextLaneConfig | undefined>;
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
  // The context sidebar exists only if something is tagged `context-tool`, or
  // was added to it by hand.
  const hasContext = useContextLane(props.contextLane).exists;

  // Remount key for the main view: just the selected doc. Checkpoint pins are
  // streamed by the overlay provider on the descriptors' *backing* urls and
  // `OverlayRepo` swaps handle backings in place, so scrubbing history must not
  // change this key. Stamping heads here would also override the streamed pin:
  // in `OverlayRepo`, heads on the presented url win over the backing's.
  const mainViewKey = createMemo<string | undefined>(() =>
    props.selectedDocUrl()
  );

  const [draftOverlayProviderHost, setDraftOverlayProviderHost] =
    createSignal<HTMLElement>();
  const isDraftOverlayProviderReady = useProviderReady(
    "patchwork-draft-overlay-provider",
    draftOverlayProviderHost
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
      isDraftOverlayProviderReady() &&
      isCommentsProviderReady() &&
      isFocusProviderReady()
  );

  // Components tagged `document-provider` (patch layers, say) sit inside the
  // draft overlay and above everything else, so they can remap what the
  // document views resolve while stacking over the draft.
  const documentProviders = useTaggedComponents("document-provider");
  const documentProviderIds = createMemo(
    () => documentProviders().map((c) => c.id),
    [],
    {
      equals: (a, b) =>
        a.length === b.length && a.every((id, i) => id === b[i]),
    }
  );

  return (
    <patchwork-view
      component="patchwork-draft-overlay-provider"
      ref={setDraftOverlayProviderHost}
    >
      <ProviderStack
        ids={documentProviderIds()}
        render={() => (
          <patchwork-view
            component="patchwork-comments-provider"
            ref={setCommentsProviderElement}
          >
            <patchwork-view
              component="patchwork-focus-provider"
              ref={setFocusProviderElement}
            >
              <Show when={areDocProvidersReady()}>
                <CommentsOpener
                  element={focusProviderElement()!}
                  open={(toolId) => {
                    props.setSelectedContextToolId(toolId);
                    props.setIsRightSidebarCollapsed(false);
                  }}
                />
                <div class="frame__main-column">
                  <div class="frame__doc-column">
                    <FrameTopBar
                      docUrl={props.selectedDocUrl}
                      toolSlots={props.doctitleSlots}
                      hiddenTools={props.doctitleHidden}
                      isLeftCollapsed={props.isLeftCollapsed}
                      hasContext={hasContext}
                      isRightCollapsed={props.isRightSidebarCollapsed}
                      onToggleRight={() =>
                        props.setIsRightSidebarCollapsed((v) => !v)
                      }
                    />

                    {/* where the call's stage goes: data-call-stage */}
                    <div class="main-area" data-call-stage>
                      <MainDocumentView
                        viewKey={mainViewKey}
                        selectedDocUrl={props.selectedDocUrl}
                        toolId={props.selectedToolId}
                        // Always pass a function ref. Passing `ref={undefined}`
                        // (the hosted path, where no frame ref is threaded)
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
                      config={props.contextLane}
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
        )}
      />
    </patchwork-view>
  );
}

// Mounts each provider component inside the one before it, rendering what's
// beneath only once each has mounted, so nothing resolves around it.
function ProviderStack(props: {
  ids: readonly string[];
  render: () => JSX.Element;
}): JSX.Element {
  return (
    <Show when={props.ids[0]} keyed fallback={props.render()}>
      {(id) => {
        const [host, setHost] = createSignal<HTMLElement>();
        const ready = useProviderReady(id, host);
        return (
          <patchwork-view component={id} ref={setHost}>
            <Show when={ready()}>
              <ProviderStack ids={props.ids.slice(1)} render={props.render} />
            </Show>
          </patchwork-view>
        );
      }}
    </Show>
  );
}
