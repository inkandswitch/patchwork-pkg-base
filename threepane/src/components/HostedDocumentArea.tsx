/**
 * The document area, mounted by another component instead of rendered inline.
 *
 * Normally `PatchworkFrame` renders `DocumentAreaRoot` directly. When the frame
 * tool's element carries a `document-area-host` attribute (a
 * `patchwork:component` id), the document area is handed to that host instead:
 *
 *   <patchwork-view
 *     component={host}
 *     root-component="threepane-document-area"
 *     doc-urls="automerge:…,automerge:…">
 *     <script type="application/json">{…props}</script>
 *   </patchwork-view>
 *
 * The host decides where and how to mount `threepane-document-area` (registered
 * in index.tsx, implemented by `mountDocumentArea` below). `doc-urls` lists the
 * docs the document area needs; the props script is plain JSON, rewritten in
 * place when a prop changes.
 */

import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import { createMemo } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { ContextLaneConfig, ToolSlot } from "../types";
import { render } from "solid-js/web";
import type { DocumentAreaInputs } from "./DocumentAreaRoot";
import { DocumentAreaRoot } from "./DocumentAreaRoot";
import { DEFAULT_SIDEBAR_WIDTH } from "../hooks";
import { ensureFrameStyles } from "../ensureFrameStyles";

export const DOCUMENT_AREA_COMPONENT = "threepane-document-area";

export interface HostedDocumentAreaProps extends DocumentAreaInputs {
  /** The `patchwork:component` that mounts the document area. */
  host: string;
  /** Added to `doc-urls`. */
  contactUrl: AutomergeUrl | undefined;
}

export function HostedDocumentArea(props: HostedDocumentAreaProps) {
  // The docs the document area needs. The context-tool and tray lanes add
  // nothing: they're bare `patchwork:component`s with no doc of their own.
  const docUrls = createMemo<AutomergeUrl[]>(() => {
    const urls = new Set<AutomergeUrl>();
    const selected = props.selectedDocUrl();
    if (selected) urls.add(selected);
    if (props.contactUrl) urls.add(props.contactUrl);
    return [...urls];
  });

  // JSON only (no accessors or handles), read back by `mountDocumentArea`.
  const propsJson = createMemo(() =>
    JSON.stringify({
      selectedDocUrl: props.selectedDocUrl(),
      selectedToolId: props.selectedToolId(),
      doctitleSlots: props.doctitleSlots(),
      doctitleHidden: props.doctitleHidden(),
      contextLane: props.contextLane(),
      isLeftCollapsed: props.isLeftCollapsed(),
      initialRightWidth: props.initialRightWidth(),
      initialRightCollapsed: props.initialRightCollapsed(),
    } satisfies DocumentAreaProps)
  );

  return (
    <patchwork-view
      component={props.host}
      root-component={DOCUMENT_AREA_COMPONENT}
      // `attr:` sets a DOM attribute, not a JS property, so a host can read it
      // with getAttribute and watch it with a MutationObserver.
      attr:doc-urls={docUrls().join(",")}
      style={{ display: "contents" }}
    >
      <script type="application/json">{propsJson()}</script>
    </patchwork-view>
  );
}

interface DocumentAreaProps {
  selectedDocUrl?: AutomergeUrl;
  selectedToolId?: string;
  doctitleSlots?: ToolSlot[];
  doctitleHidden?: string[];
  contextLane?: ContextLaneConfig;
  isLeftCollapsed?: boolean;
  initialRightWidth?: number;
  initialRightCollapsed?: boolean;
}

function parseProps(script: HTMLScriptElement | null): DocumentAreaProps {
  if (!script?.textContent) return {};
  try {
    return JSON.parse(script.textContent) as DocumentAreaProps;
  } catch (err) {
    console.error(`[${DOCUMENT_AREA_COMPONENT}] bad props JSON:`, err);
    return {};
  }
}

/**
 * The `threepane-document-area` mount fn. Reads its props from the JSON
 * `<script>` child of `element`, and re-reads them whenever that script's text
 * changes, so a prop change (a collapse toggle, a tool reorder) updates in
 * place. Context-tool and tray content resolves against whatever registry the
 * realm it mounts in has.
 */
export function mountDocumentArea(element: HTMLElement): () => void {
  // The stylesheet goes into whichever document this mounts in.
  ensureFrameStyles();

  const script = element.querySelector<HTMLScriptElement>(
    ':scope > script[type="application/json"]'
  );
  const [p, setP] = createStore<DocumentAreaProps>(parseProps(script));

  // `reconcile` diffs, so only the fields that changed update.
  const observer = new MutationObserver(() => {
    setP(reconcile(parseProps(script)));
  });
  if (script) {
    observer.observe(script, {
      characterData: true,
      childList: true,
      subtree: true,
    });
  }

  // The stylesheet's rules are nested under `.frame {`, so the document area
  // needs a `.frame` ancestor. `render` mounts beside the props script and
  // leaves it alone.
  const dispose = render(
    () => (
      <div class="frame">
        <DocumentAreaRoot
          selectedDocUrl={() => p.selectedDocUrl}
          selectedToolId={() => p.selectedToolId}
          doctitleSlots={() => p.doctitleSlots}
          doctitleHidden={() => p.doctitleHidden}
          contextLane={() => p.contextLane}
          isLeftCollapsed={() => p.isLeftCollapsed ?? false}
          initialRightWidth={() => p.initialRightWidth ?? DEFAULT_SIDEBAR_WIDTH}
          initialRightCollapsed={() => p.initialRightCollapsed ?? false}
        />
      </div>
    ),
    element
  );

  return () => {
    observer.disconnect();
    dispose();
  };
}
