import "@inkandswitch/patchwork-elements";
import { useDocHandle } from "@automerge/automerge-repo-solid-primitives";
import type {
  AutomergeUrl,
  Doc,
  DocHandle,
  Repo,
} from "@automerge/automerge-repo";
import type { AccountDoc } from "./types";
import {
  useSidebarState,
  useSidebarResize,
  useProviderReady,
  useDebugRegistryToast,
  DebugRegistryToast,
} from "./hooks";
import { Sidebar } from "./components/Sidebar";
import { DocumentToolbar } from "./components/DocumentToolbar";
import { MainDocumentView } from "./components/MainDocumentView";
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";
import { subscribe } from "@inkandswitch/patchwork-providers-solid";
import { ensureAccountSubdocs } from "./account/ensureSubdocs";
import "./styles.css";

// Sidebar dimensions
const MIN_SIDEBAR_WIDTH = 48;
const DRAG_THRESHOLD = 3;

type SelectedView = {
  url: AutomergeUrl;
  toolId: string | null;
};

export const PatchworkFrame = ({
  handle,
  repo,
}: {
  handle: DocHandle<AccountDoc>;
  repo: Repo;
}) => {
  const accountDocUrl = handle.url;

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

  const [accountProviderElement, setAccountProviderElement] =
    createSignal<HTMLElement>();
  const isAccountProviderReady = useProviderReady(
    "patchwork-account-provider",
    accountProviderElement
  );

  const [selectedDocProviderElement, setSelectedDocProviderElement] =
    createSignal<HTMLElement>();
  const isSelectedDocProviderReady = useProviderReady(
    "patchwork-selected-doc-provider",
    selectedDocProviderElement
  );

  const areProvidersReady = createMemo(
    () =>
      isSelectedDocProviderReady() &&
      isCommentsProviderReady() &&
      isFocusProviderReady() &&
      isAccountProviderReady()
  );

  return (
    <div class="frame">
      {/*
        Outermost provider: wraps both sidebars and the main area so that
        `patchwork:open-document` events from anywhere (and the matching
        `patchwork:selected-doc` subscriptions) reach it. `patchwork-view`
        defaults to `display: contents`, so this wrapper is layout-neutral.
      */}
      <patchwork-view
        component="patchwork-selected-doc-provider"
        ref={setSelectedDocProviderElement}
      >
        <patchwork-view
          component="patchwork-comments-provider"
          ref={setCommentsProviderElement}
        >
          <patchwork-view
            component="patchwork-focus-provider"
            ref={setFocusProviderElement}
          >
            <patchwork-view
              component="patchwork-account-provider"
              doc-url={accountDocUrl}
              ref={setAccountProviderElement}
            >
              <Show when={areProvidersReady()}>
                <InnerPatchworkFrame handle={handle} repo={repo} />
              </Show>
            </patchwork-view>
          </patchwork-view>
        </patchwork-view>
      </patchwork-view>
    </div>
  );
};

function InnerPatchworkFrame(props: {
  handle: DocHandle<AccountDoc>;
  repo: Repo;
}) {
  // Track doc changes via a version counter so accountDoc() recomputes
  // on every change. We avoid useDocument/autoproduce because its store
  // proxying conflicts with Automerge array splice operations.
  const accountDocHandle = useDocHandle<AccountDoc>(() => props.handle.url, {
    repo: props.repo,
  });

  // Lazily populate subdoc fields (rootFolderUrl, moduleSettingsUrl, contactUrl)
  // on first mount. Each is created via createDocOfDatatype2 of its own
  // datatype, so defaults and shape are owned by the datatype, not the frame.
  void ensureAccountSubdocs(props.handle, props.repo);

  const [docVersion, setDocVersion] = createSignal(0);
  createEffect(() => {
    const h = accountDocHandle();
    if (!h) return;
    const onChange = () => setDocVersion((v) => v + 1);
    h.on("change", onChange);
    onCleanup(() => h.off("change", onChange));
  });

  const accountDoc = createMemo(() => {
    docVersion();
    return accountDocHandle()?.doc();
  });
  const accountDocUrl = props.handle.url;

  const sidebarState = useSidebarState();
  const sidebarResize = useSidebarResize({
    setLeftSidebarWidth: sidebarState.setLeftSidebarWidth,
    setRightSidebarWidth: sidebarState.setRightSidebarWidth,
    setIsSidebarCollapsed: sidebarState.setIsSidebarCollapsed,
    setIsRightSidebarCollapsed: sidebarState.setIsRightSidebarCollapsed,
    minWidth: MIN_SIDEBAR_WIDTH,
    dragThreshold: DRAG_THRESHOLD,
  });

  const {
    events: debugEvents,
    dismissEvent,
    clearAll,
  } = useDebugRegistryToast();

  const [innerElement, setInnerElement] = createSignal<HTMLElement>();

  return (
    <div ref={setInnerElement} style={{ display: "contents" }}>
      <DebugRegistryToast
        events={debugEvents()}
        onDismiss={dismissEvent}
        onClearAll={clearAll}
      />
      <Show when={innerElement()} keyed>
        {(element) => (
          <InnerPatchworkFrameContent
            element={element}
            accountDoc={accountDoc}
            accountDocUrl={accountDocUrl}
            sidebarState={sidebarState}
            sidebarResize={sidebarResize}
          />
        )}
      </Show>
    </div>
  );
}

function InnerPatchworkFrameContent(props: {
  element: HTMLElement;
  accountDoc: Accessor<Doc<AccountDoc> | undefined>;
  accountDocUrl: AutomergeUrl;
  sidebarState: ReturnType<typeof useSidebarState>;
  sidebarResize: ReturnType<typeof useSidebarResize>;
}) {
  // Subscribe from an element inside the provider wrappers so events bubble to
  // whichever provider owns the selector.
  const selectedView = subscribe<SelectedView | null>(
    props.element,
    { type: "patchwork:selected-view" },
    null
  );

  return (
    <>
      {props.accountDoc()?.accountSidebarToolId && (
        <Sidebar
          side="left"
          isCollapsed={props.sidebarState.isSidebarCollapsed}
          width={props.sidebarState.leftSidebarWidth}
          toolId={props.accountDoc()!.accountSidebarToolId}
          docUrl={props.accountDocUrl}
          onMouseDown={props.sidebarResize.handleMouseDown}
          onToggleClick={props.sidebarResize.handleToggleClick}
        />
      )}

      <div class="main-area">
        <DocumentToolbar
          toolIds={() => props.accountDoc()?.documentToolbarToolIds}
          docUrl={() => selectedView()?.url}
        />
        <MainDocumentView
          viewKey={() => selectedView()?.url}
          selectedDocUrl={() => selectedView()?.url}
          toolId={() => selectedView()?.toolId ?? undefined}
        />
      </div>

      {props.accountDoc()?.contextSidebarToolId && (
        <Sidebar
          side="right"
          isCollapsed={props.sidebarState.isRightSidebarCollapsed}
          width={props.sidebarState.rightSidebarWidth}
          toolId={props.accountDoc()!.contextSidebarToolId}
          docUrl={props.accountDocUrl}
          onMouseDown={props.sidebarResize.handleMouseDown}
          onToggleClick={props.sidebarResize.handleToggleClick}
        />
      )}
    </>
  );
}
