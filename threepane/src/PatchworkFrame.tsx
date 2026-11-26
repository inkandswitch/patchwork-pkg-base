import "@inkandswitch/patchwork-elements";
import { useDocHandle, useDocument } from "solid-automerge";
import {
  parseAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";
import { subscribe } from "@inkandswitch/patchwork-providers";
import type {
  OpenDocumentEvent,
  OpenDocumentEventDetail,
} from "@inkandswitch/patchwork-elements";
import type { AccountDoc, ThreepaneConfigDoc, ToolSlot } from "./types";
import {
  useSidebarState,
  useSidebarResize,
  useMainDocMounted,
  SIDEBAR_KEYS,
  COLLAPSE_CONTEXT_SIDEBAR_EVENT,
  getStoredNumber,
  getStoredBoolean,
  DEFAULT_SIDEBAR_WIDTH,
} from "./hooks";
import { Sidebar } from "./components/Sidebar";
import { SidebarWidgets } from "./components/SidebarWidgets";
import { DocumentAreaRoot } from "./components/DocumentAreaRoot";
import { HostedDocumentArea } from "./components/HostedDocumentArea";
import { MainDocumentView } from "./components/MainDocumentView";
import { Tray } from "./components/Tray";
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
  type Accessor,
  type JSX,
} from "solid-js";
import { Portal, render } from "solid-js/web";
import type { ToolImplementation } from "@inkandswitch/patchwork-plugins";
import { ensureThreepaneConfig } from "./account/ensureThreepaneConfig";
import { seedExampleDocuments } from "./account/seedExampleDocuments";
import { handleAddToSidebar } from "./account/addToSidebar";
import { handleLayoutEdits } from "./layoutEdits";
import { ensureFrameStyles } from "./ensureFrameStyles";
import { useHandleDoc } from "./hooks/useHandleDoc";
import { CALL_PROVIDER } from "./datatypes";

type SelectedView = {
  url: AutomergeUrl;
  toolId: string | null;
};

const ACCOUNT_URL_STORAGE_KEY = "tinyPatchworkAccountUrl";

type SidebarResize = ReturnType<typeof useSidebarResize>;
type SidebarState = ReturnType<typeof useSidebarState>;

// Keep this tiny hook local to the frame chunk. Importing it from the shared
// hooks chunk has produced an undefined binding in Safari before the frame can
// mount its providers.
const useFrameProviderReady = (
  componentId: string,
  element: Accessor<HTMLElement | undefined>
): Accessor<boolean> => {
  const [isReady, setReady] = createSignal(false);

  createEffect(() => {
    const el = element();
    if (!el) return;
    setReady(false);
    const onMounted = (event: Event) => {
      const detail = (event as CustomEvent<{ componentId?: string }>).detail;
      if (detail?.componentId !== componentId) return;
      setReady(true);
    };
    el.addEventListener("patchwork:mounted", onMounted);
    onCleanup(() => el.removeEventListener("patchwork:mounted", onMounted));
  });

  return isReady;
};

// Fire a `patchwork:open-document` request from an account-bar button. Bubbles +
// composed so it reaches the footer intercept (hosted document area → popover)
// or the selected-doc provider (otherwise → main frame), matching the sideboard
// tool.
function dispatchOpen(el: HTMLElement, detail: OpenDocumentEventDetail) {
  el.dispatchEvent(
    new CustomEvent("patchwork:open-document", {
      detail,
      bubbles: true,
      composed: true,
    })
  );
}

export function PatchworkFrame({
  handle,
  repo,
  ...props
}: {
  handle: DocHandle<AccountDoc>;
  repo: Repo;
  documentAreaHost?: string;
}) {
  ensureFrameStyles();
  const accountDocUrl = handle.url;

  const [accountProviderElement, setAccountProviderElement] =
    createSignal<HTMLElement>();
  const isAccountProviderReady = useFrameProviderReady(
    "patchwork-account-provider",
    accountProviderElement
  );

  const [toolStorageProviderElement, setToolStorageProviderElement] =
    createSignal<HTMLElement>();
  const isToolStorageProviderReady = useFrameProviderReady(
    "patchwork-tool-storage-provider",
    toolStorageProviderElement
  );

  const [selectedDocProviderElement, setSelectedDocProviderElement] =
    createSignal<HTMLElement>();
  const isSelectedDocProviderReady = useFrameProviderReady(
    "patchwork-selected-doc-provider",
    selectedDocProviderElement
  );

  // patchwork-worker-provider isn't waited on. It listens at the document, so
  // mount order doesn't matter, and patchwork-view sends no event when a
  // component fails to load, so waiting on it can leave the frame blank.
  const areProvidersReady = createMemo(
    () =>
      isSelectedDocProviderReady() &&
      isAccountProviderReady() &&
      isToolStorageProviderReady()
  );

  return (
    <div class="frame-shell">
      <aside class="frame-warning-banner">
        research grade software. do not share links. sharing a doc is sharing
        your account.
      </aside>
      <div class="frame">
        {/*
        Outermost providers: wrap both sidebars and the main area so that
        `patchwork:open-document` events from anywhere (and the matching
        `patchwork:selected-doc` subscriptions) reach them. The comments and
        focus providers are deliberately *not* here - they live inside the
        per-draft overlay (inside `DocumentAreaRoot`) so branch comments resolve
        against the draft's clone. `patchwork-view` defaults to
        `display: contents`, so these wrappers are layout-neutral.
      */}
        <patchwork-view
          component="patchwork-selected-doc-provider"
          ref={setSelectedDocProviderElement}
        >
          <patchwork-view
            component="patchwork-account-provider"
            doc-url={accountDocUrl}
            ref={setAccountProviderElement}
          >
            <patchwork-view
              component="patchwork-tool-storage-provider"
              doc-url={accountDocUrl}
              ref={setToolStorageProviderElement}
            >
              {/*
                Runs workers (like the LLM's) on the host for
                patchwork:worker-channel subscriptions, including ones relayed
                out of a hosted document area. It wraps the document area because this
                element is the ctx a worker spec's open(ctx) gets.
              */}
              <patchwork-view component="patchwork-worker-provider">
                {/*
                  The call (the call package): round everything, so it hears
                  every doc on screen, reaches the title bar and both
                  sidebars, and carries on as docs change. Not waited on: it's
                  late-bound, and renders nothing without the package.
                */}
                <patchwork-view component={CALL_PROVIDER}>
                  <Show when={areProvidersReady()}>
                    <PatchworkFrameInner
                      handle={handle}
                      repo={repo}
                      documentAreaHost={props.documentAreaHost}
                    />
                  </Show>
                </patchwork-view>
              </patchwork-view>
            </patchwork-view>
          </patchwork-view>
        </patchwork-view>
      </div>
    </div>
  );
}

function PatchworkFrameInner(props: {
  handle: DocHandle<AccountDoc>;
  repo: Repo;
  documentAreaHost?: string;
}) {
  const accountDocHandle = useDocHandle<AccountDoc>(() => props.handle.url, {
    repo: props.repo,
  });

  // Lazily populate subdoc fields (rootFolderUrl, moduleSettingsUrl, contactUrl)
  // on first mount, then create the threepane layout config doc and migrate the
  // legacy account arrays into it (non-destructive — old fields stay so older
  // builds keep working).
  void (async () => {
    await ensureThreepaneConfig(props.handle, props.repo);
    await seedExampleDocuments(props.handle, props.repo);
  })().catch((err) => {
    console.error("frame: account bootstrap failed", err);
  });

  const accountDoc = useHandleDoc(accountDocHandle);
  const accountDocUrl = props.handle.url;

  // The threepane layout config doc (sidebar widgets / context tabs / doctitle
  // tools).
  const threepaneUrl = () => accountDoc()?.tools?.["threepane"];
  const threepaneConfigHandle = useDocHandle<ThreepaneConfigDoc>(
    () => threepaneUrl(),
    { repo: props.repo }
  );
  const threepaneConfig = useHandleDoc(threepaneConfigHandle);

  // Derived layout lanes, read from the threepane config doc. Slots are a
  // [toolId, docId] tuple or a bare component-id string; SlotView decides how
  // to render each. `tray` is the system tray's explicit ordered list of tools,
  // rendered by the one stable host-owned instance below.
  const doctitleSlots = () => threepaneConfig()?.doctitle?.tools;
  const doctitleHidden = () => threepaneConfig()?.doctitle?.hidden;
  const contextLane = () => threepaneConfig()?.context;
  const sidebarWidgets = (): ToolSlot[] =>
    threepaneConfig()?.sidebar?.widgets ?? [];
  const traySlots = (): ToolSlot[] => threepaneConfig()?.tray ?? [];
  const rootFolderUrl = () => accountDoc()?.rootFolderUrl;

  // your name, for the account bar: only a registered contact has one
  const [contact] = useDocument<{ type?: string; name?: string }>(
    () => accountDoc()?.contactUrl,
    { repo: props.repo }
  );
  const contactName = () => {
    const doc = contact();
    return doc?.type === "registered" ? (doc.name ?? "").trim() : "";
  };

  const sidebarState = useSidebarState();
  const sidebarResize = useSidebarResize("left", {
    isCollapsed: sidebarState.isSidebarCollapsed,
    setCollapsed: sidebarState.setIsSidebarCollapsed,
    setWidth: sidebarState.setLeftSidebarWidth,
  });

  let element!: HTMLDivElement;
  const [selectedView, setSelectedView] = createSignal<SelectedView | null>(
    null
  );

  // When a host mounts the document area, it may be somewhere these frame
  // tools can't run (another realm, without this repo). So the frame tools
  // opened from the account bar (Settings / Packages) are not routed into it
  // as a `selected-view`. FrameLayout stops their `patchwork:open-document`
  // events before they reach the selected-doc provider and surfaces them here,
  // floating in a popover over the frame. With the document area rendered
  // inline this stays null and they open in the main frame as usual.
  const [popoverView, setPopoverView] = createSignal<SelectedView | null>(null);

  onMount(() => {
    const unsubscribeSelectedView = subscribe<SelectedView | null>(
      element,
      { type: "patchwork:selected-view" },
      (view) => setSelectedView(view)
    );

    onCleanup(unsubscribeSelectedView);
    onCleanup(handleAddToSidebar(element, props.repo, props.handle));
    // The tab bar's and top bar's add / remove / hide / show.
    onCleanup(
      handleLayoutEdits(element, (fn) => threepaneConfigHandle()?.change(fn))
    );
  });

  const selectedDocUrl = () => selectedView()?.url;
  const selectedToolId = () => selectedView()?.toolId ?? undefined;

  // Right-sidebar seeds, read from this realm's localStorage and handed to
  // whichever document area renders: the inline `DocumentAreaRoot`, or the
  // hosted one through its props (a host may mount it where localStorage isn't
  // this one). The right-sidebar collapse/width state and the selected context
  // tab then live *inside* `DocumentAreaRoot`, so the context sidebar goes
  // wherever the main view goes. The system tray stays frame chrome in the left
  // sidebar (see `FrameLayout`).
  const initialRightWidth = () =>
    getStoredNumber(SIDEBAR_KEYS.rightWidth, DEFAULT_SIDEBAR_WIDTH);
  const initialRightCollapsed = () =>
    getStoredBoolean(SIDEBAR_KEYS.rightCollapsed);

  // Suspend the sidebar widgets until the main document has settled (mounted or
  // failed to mount), so the primary column wins the initial render race. With
  // no document selected there's nothing to wait for, so the widgets show
  // immediately. Latched: once revealed they stay mounted across later doc
  // switches — we only want to win the *first* race, not re-suspend every time.
  //
  // A hosted document area never sets the mount ref here, so the widgets show
  // at once instead of waiting on a mount this frame won't see.
  const [mainDocElement, setMainDocElement] = createSignal<HTMLElement>();
  const isMainDocMounted = useMainDocMounted(mainDocElement, selectedDocUrl);
  const [widgetsReady, setWidgetsReady] = createSignal(false);
  createEffect(() => {
    if (widgetsReady()) return;
    if (props.documentAreaHost || !selectedDocUrl() || isMainDocMounted())
      setWidgetsReady(true);
  });

  return (
    <div ref={element} style={{ display: "contents" }}>
      {/*
        FrameLayout (the left sidebar + its toggle) is rendered ONCE, outside
        the doc-selection Show. Selecting the first document only swaps the main
        column below; it must not tear down and rebuild the entire left sidebar
        (widgets, account bar) — that's a full-world remount on first click.
      */}
      <FrameLayout
        accountDocUrl={accountDocUrl}
        sidebarState={sidebarState}
        sidebarResize={sidebarResize}
        sidebarWidgets={sidebarWidgets}
        traySlots={traySlots}
        configHandle={threepaneConfigHandle}
        rootFolderUrl={rootFolderUrl}
        widgetsReady={widgetsReady}
        contactUrl={() => accountDoc()?.contactUrl}
        contactName={contactName}
        moduleSettingsUrl={() => accountDoc()?.moduleSettingsUrl}
        accountBarInPopover={!!props.documentAreaHost}
        onInterceptOpen={setPopoverView}
      >
        <Show
          when={selectedDocUrl()}
          fallback={
            <div class="main-area">
              <MainDocumentView
                viewKey={selectedDocUrl}
                selectedDocUrl={selectedDocUrl}
                toolId={selectedToolId}
                ref={setMainDocElement}
              />
            </div>
          }
        >
          {/*
            Document area: rendered inline, or handed to the component named
            by `documentAreaHost` (fixed per tool instance). Both render the
            whole main column (doc column + context sidebar) and own the
            right-sidebar state, seeded from the localStorage reads above. The
            inline one also threads `setMainDocElement` for the widgetsReady
            race.
          */}
          <Show
            when={props.documentAreaHost}
            fallback={
              <DocumentAreaRoot
                setMainDocElement={setMainDocElement}
                selectedDocUrl={selectedDocUrl}
                selectedToolId={selectedToolId}
                doctitleSlots={doctitleSlots}
                doctitleHidden={doctitleHidden}
                contextLane={contextLane}
                isLeftCollapsed={sidebarState.isSidebarCollapsed}
                initialRightWidth={initialRightWidth}
                initialRightCollapsed={initialRightCollapsed}
              />
            }
          >
            {(host) => (
              <HostedDocumentArea
                host={host()}
                contactUrl={accountDoc()?.contactUrl}
                selectedDocUrl={selectedDocUrl}
                selectedToolId={selectedToolId}
                doctitleSlots={doctitleSlots}
                doctitleHidden={doctitleHidden}
                contextLane={contextLane}
                isLeftCollapsed={sidebarState.isSidebarCollapsed}
                initialRightWidth={initialRightWidth}
                initialRightCollapsed={initialRightCollapsed}
              />
            )}
          </Show>
        </Show>
      </FrameLayout>

      <Show when={popoverView()}>
        {(view) => (
          <FramePopover view={view()} onClose={() => setPopoverView(null)} />
        )}
      </Show>
    </div>
  );
}

// The account-bar popover, used when the document area is hosted: floats a
// frame tool (Settings / Packages) over the frame on a dimmed, theme-tinted
// wash so it runs here instead of being routed into the hosted main frame.
// Click the backdrop or press Escape to dismiss.
function FramePopover(props: { view: SelectedView; onClose: () => void }) {
  // The tool the popover currently renders the doc with. Seeded from the
  // intercepted open request and re-pointed by the "Open with" picker in the
  // toolbar (below) without leaving the popover. Reset whenever a fresh view is
  // opened.
  const [toolId, setToolId] = createSignal(props.view.toolId ?? undefined);
  createEffect(() => setToolId(props.view.toolId ?? undefined));

  let popoverEl: HTMLDivElement | undefined;

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));

    // The "Open with" picker (and any tool inside the popover) fires
    // `patchwork:open-document`. Catch it here and re-point the popover in place
    // rather than letting it bubble out to the selected-doc provider — these are
    // frame tools that must not be routed into the hosted main frame (the whole
    // reason this popover exists).
    const el = popoverEl;
    if (!el) return;
    const onOpen = (event: OpenDocumentEvent) => {
      const { url, toolId: nextToolId } = event.detail;
      if (!url) return;
      event.stopPropagation();
      setToolId(nextToolId ?? undefined);
    };
    el.addEventListener("patchwork:open-document", onOpen);
    onCleanup(() => el.removeEventListener("patchwork:open-document", onOpen));
  });

  return (
    <div class="frame__popover-backdrop" onClick={() => props.onClose()}>
      <div
        ref={popoverEl}
        class="frame__popover"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {/*
          "Open with" lets you re-point the popover at a different tool for the
          same doc. Its `patchwork:open-document` event is intercepted above and
          swaps `toolId` below in place.
        */}
        <div class="frame__popover-toolbar">
          <patchwork-view doc-url={props.view.url} tool-id="doc-openwith" />
        </div>
        <div class="frame__popover-body">
          <patchwork-view doc-url={props.view.url} tool-id={toolId()} />
        </div>
      </div>
    </div>
  );
}

// Host-side frame chrome: the left (account) sidebar plus a slot for the main
// column (`children`). Rendered once and kept mounted across the no-doc → doc
// transition; only its `children` (the main column) swap. The right context
// sidebar/tray are host chrome rendered by `PatchworkFrameInner`.
export function FrameLayout(props: {
  accountDocUrl: AutomergeUrl;
  sidebarState: SidebarState;
  sidebarResize: SidebarResize;
  sidebarWidgets: Accessor<ToolSlot[]>;
  /** The system-tray tools, configured on the threepane config doc. */
  traySlots: Accessor<ToolSlot[]>;
  configHandle: Accessor<DocHandle<ThreepaneConfigDoc> | undefined>;
  rootFolderUrl: Accessor<AutomergeUrl | undefined>;
  widgetsReady: Accessor<boolean>;
  /** Account subdocs for the inlined account bar (you + Packages). */
  contactUrl: Accessor<AutomergeUrl | undefined>;
  /** Your name, beside your picture; "" when you've none (just the picture). */
  contactName?: Accessor<string>;
  moduleSettingsUrl: Accessor<AutomergeUrl | undefined>;
  /**
   * Fixed per tool instance: open account-bar tools in the popover rather than
   * the main frame (because the document area is hosted).
   */
  accountBarInPopover?: boolean;
  /** `accountBarInPopover` only: called with an account-bar tool to open. */
  onInterceptOpen?: (view: SelectedView) => void;
  children: JSX.Element;
}) {
  const isCollapsed = props.sidebarState.isSidebarCollapsed;
  const myName = () => props.contactName?.() ?? "";
  const [accountMenu, setAccountMenu] = createSignal<{ x: number; y: number }>();
  const accountKey = () =>
    `account:${encodeURIComponent(myName())}/${parseAutomergeUrl(props.accountDocUrl).documentId}`;

  createEffect(() => {
    if (!accountMenu()) return;
    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest(".threepane-account-menu"))
        return;
      setAccountMenu(undefined);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountMenu(undefined);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    });
  });

  function showAccountMenu(event: MouseEvent) {
    event.preventDefault();
    setAccountMenu({
      x: Math.max(4, Math.min(event.clientX, window.innerWidth - 184)),
      y: Math.max(4, Math.min(event.clientY, window.innerHeight - 96)),
    });
  }

  function signOut() {
    localStorage.removeItem(ACCOUNT_URL_STORAGE_KEY);
    window.location.replace("/");
  }

  // The system tray is docked to the frame's bottom-left, OUTSIDE the collapsing
  // sidebar. Its tools are configured on the threepane config doc's `tray`
  // array. We use the list here to reserve matching space at the sidebar's
  // bottom (so the account bar clears the dock when open) and to skip the dock
  // entirely when nothing is configured. The dock stays mounted when the sidebar
  // closes — it's hidden with CSS (below), not unmounted, so its tools keep
  // running.
  const hasTray = () => props.traySlots().length > 0;

  // One `patchwork:open-document` listener on the sidebar content, for two jobs:
  //
  // 1. `accountBarInPopover` only: events from the account bar (Settings /
  //    Packages) are stopped here and handed to the popover. Left to propagate
  //    they'd select a view for the hosted main frame, which may be somewhere
  //    these frame tools can't run. Otherwise they pass straight through to
  //    the selected-doc provider.
  //
  // 2. Narrow viewports: when the left sidebar covers most of the frame (>75%
  //    of the viewport width — acting as a full-screen overlay rather than a
  //    side rail), opening a document from it collapses both sidebars so the
  //    document takes over. Account-bar events intercepted in (1) don't.
  //
  // The sidebar content (account bar included) is unmounted once collapsed and
  // rebuilt on re-expand (see `Sidebar`), so this effect rebinds whenever a new
  // content element mounts rather than once — otherwise the first collapse
  // destroys the element the listener was on and it never fires again.
  const [sidebarContentEl, setSidebarContentEl] =
    createSignal<HTMLDivElement>();
  let footerEl: HTMLDivElement | undefined;
  createEffect(() => {
    const el = sidebarContentEl();
    if (!el) return;
    const onOpen = (event: OpenDocumentEvent) => {
      const { url, toolId } = event.detail;
      const footer = footerEl;
      if (
        props.accountBarInPopover &&
        url &&
        footer &&
        event.composedPath().includes(footer)
      ) {
        event.stopPropagation();
        props.onInterceptOpen?.({ url, toolId: toolId ?? null });
        return;
      }
      if (el.getBoundingClientRect().width <= window.innerWidth * 0.75) return;
      props.sidebarState.setIsSidebarCollapsed(true);
      window.dispatchEvent(new CustomEvent(COLLAPSE_CONTEXT_SIDEBAR_EVENT));
    };
    el.addEventListener("patchwork:open-document", onOpen);
    onCleanup(() => el.removeEventListener("patchwork:open-document", onOpen));
  });

  return (
    <>
      {/*
        The left toggle is pinned to the frame's top-left corner (absolute,
        outside the collapsing sidebar) so it holds the same spot whether the
        sidebar is open or closed. The title, in the top bar, slides up against
        it as the sidebar closes rather than travelling the full sidebar width.
      */}
      <button
        type="button"
        class="frame__sidebar-toggle frame__left-toggle"
        title={isCollapsed() ? "Show sidebar" : "Hide sidebar"}
        aria-label={isCollapsed() ? "Show sidebar" : "Hide sidebar"}
        aria-pressed={!isCollapsed()}
        onClick={() => props.sidebarState.setIsSidebarCollapsed((v) => !v)}
      >
        <PanelLeftIcon />
      </button>

      <Sidebar
        side="left"
        isCollapsed={isCollapsed}
        width={props.sidebarState.leftSidebarWidth}
        onMouseDown={props.sidebarResize.handleMouseDown}
        onToggleClick={props.sidebarResize.handleToggleClick}
      >
        <div
          class="threepane-sidebar"
          classList={{ "threepane-sidebar--has-tray": hasTray() }}
          ref={setSidebarContentEl}
        >
          <SidebarWidgets
            widgets={props.sidebarWidgets}
            configHandle={props.configHandle}
            rootFolderUrl={props.rootFolderUrl}
            ready={props.widgetsReady}
          />
          {/*
            The account bar, pinned to the sidebar's bottom: you (your picture
            and your name), which opens the settings page, and Packages. Each
            button dispatches a `patchwork:open-document` event (bubbles +
            composed), which the footer intercepts into the popover when the
            document area is hosted, or lets bubble to the selected-doc provider otherwise.
          */}
          <div class="threepane-sidebar__footer" ref={footerEl}>
            <footer class="threepane-account-bar">
              <button
                type="button"
                class="threepane-account-bar__me"
                title="Settings"
                aria-label="Settings"
                aria-haspopup="menu"
                onClick={(e) =>
                  dispatchOpen(e.currentTarget, {
                    url: props.accountDocUrl,
                    toolId: "settings",
                  })
                }
                onContextMenu={showAccountMenu}
              >
                <Show
                  when={props.contactUrl()}
                  fallback={<span class="threepane-account-bar__nobody" />}
                >
                  {(contactUrl) => (
                    <patchwork-view
                      doc-url={contactUrl()}
                      tool-id="contact-avatar"
                    />
                  )}
                </Show>
                <Show when={myName()}>
                  <span class="threepane-account-bar__name">{myName()}</span>
                </Show>
              </button>
              <Show when={accountMenu()}>
                {(position) => (
                  <Portal>
                    <div
                      class="threepane-account-menu"
                      role="menu"
                      aria-label="Account actions"
                      style={{
                        left: `${position().x}px`,
                        top: `${position().y}px`,
                      }}
                      onKeyDown={(event) => {
                        const items = [
                          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                            '[role="menuitem"]'
                          ),
                        ];
                        const index = items.indexOf(
                          document.activeElement as HTMLButtonElement
                        );
                        const focus = (next: number) =>
                          items[
                            (next + items.length) % items.length
                          ]?.focus();
                        if (event.key === "ArrowDown") focus(index + 1);
                        else if (event.key === "ArrowUp")
                          focus(index < 0 ? items.length - 1 : index - 1);
                        else return;
                        event.preventDefault();
                      }}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        ref={(el) => queueMicrotask(() => el.focus())}
                        onClick={() => {
                          navigator.clipboard.writeText(accountKey());
                          setAccountMenu(undefined);
                        }}
                      >
                        Copy account key
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAccountMenu(undefined);
                          signOut();
                        }}
                      >
                        Sign out
                      </button>
                    </div>
                  </Portal>
                )}
              </Show>

              <Show when={props.moduleSettingsUrl()}>
                {(moduleSettingsUrl) => (
                  <button
                    type="button"
                    class="threepane-account-bar__button"
                    onClick={(e) =>
                      dispatchOpen(e.currentTarget, {
                        url: moduleSettingsUrl(),
                        toolId: "packages",
                      })
                    }
                  >
                    Packages
                  </button>
                )}
              </Show>
            </footer>
          </div>
        </div>
      </Sidebar>

      {/*
        The system tray, docked to the frame's bottom-left. Rendered here —
        outside the collapsing <Sidebar> — as trusted host chrome, one stable
        instance. When the sidebar is open the dock spans its width and sits in
        the space reserved by `threepane-sidebar--has-tray`, above the account
        bar. When the sidebar closes the dock is hidden (`--collapsed` fades it
        out at once) rather than unmounted, so the tray is invisible but its
        tools keep running. On open it fades back in only after the sidebar's
        expand animation finishes, so it never flashes over the growing sidebar.
      */}
      <Show when={hasTray()}>
        <div
          class="frame__tray-dock"
          classList={{ "frame__tray-dock--collapsed": isCollapsed() }}
          style={{ width: `${props.sidebarState.leftSidebarWidth()}px` }}
        >
          <Tray slots={props.traySlots} />
        </div>
      </Show>

      {props.children}
    </>
  );
}

// lucide `panel-left`
function PanelLeftIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--studio-chrome-line)"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

/**
 * The frame tool. If the tool's element has a `document-area-host` attribute,
 * the document area is handed to that `patchwork:component` (see
 * components/HostedDocumentArea.tsx) instead of rendered inline. Read once, at
 * mount.
 */
export function renderPatchworkFrame(): ToolImplementation<AccountDoc> {
  return (handle, element) => {
    const documentAreaHost =
      element.getAttribute("document-area-host") || undefined;
    return render(
      () => (
        <PatchworkFrame
          handle={handle}
          repo={element.repo}
          documentAreaHost={documentAreaHost}
        />
      ),
      element
    );
  };
}
