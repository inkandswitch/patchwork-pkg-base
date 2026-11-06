import {
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type Repo,
} from "@automerge/automerge-repo/slim";
import { subscribe } from "@inkandswitch/patchwork-providers-solid";
import {
  createContext,
  createMemo,
  createSignal,
  onCleanup,
  Show,
  Suspense,
  useContext,
  type JSX,
} from "solid-js";

const OVERLAY_COMPONENT = "patchwork-draft-overlay";
const MOUNT_TIMEOUT_MS = 3000;

// What the drafts package's overlay answers for `draft:changes`.
export type DocChange = "added" | "modified";
export type RemovedEntry = {
  url: AutomergeUrl;
  name: string;
  type: string;
  folder: AutomergeUrl;
  after: AutomergeUrl | null;
};
type DraftChanges = {
  changed: Record<AutomergeUrl, DocChange>;
  removed: Record<AutomergeUrl, RemovedEntry[]>;
  containing: AutomergeUrl[];
};

export type RowChange = DocChange | "removed" | "contains";

type Changes = {
  of: (url: AutomergeUrl) => RowChange | undefined;
  removedFrom: (folderUrl: AutomergeUrl) => RemovedEntry[];
};

const NO_CHANGES: DraftChanges = { changed: {}, removed: {}, containing: [] };

const ChangesContext = createContext<Changes | null>(null);

// The changes of the workspace a row is in, or null outside any.
export function useChanges(): Changes | null {
  return useContext(ChangesContext);
}

// A workspace folder, the way the draft it has checked out has it: the
// drafts package's overlay hands everything inside a repo that reads (and
// writes) that draft, and says what changed. Until it has mounted this shows
// `loading`; if it never does (no drafts package), the folder shows through
// `repo` as it is.
export function WorkspaceOverlay(props: {
  url: AutomergeUrl;
  repo: Repo;
  loading: JSX.Element;
  children: (repo: Repo) => JSX.Element;
}) {
  const [element, setElement] = createSignal<HTMLElement & { repo?: Repo }>();
  const [mounted, setMounted] = createSignal(false);
  const [gaveUp, setGaveUp] = createSignal(false);
  const timer = setTimeout(() => setGaveUp(true), MOUNT_TIMEOUT_MS);
  onCleanup(() => clearTimeout(timer));

  // In the ref rather than an effect: the component can mount before
  // effects run.
  const bind = (el: HTMLElement & { repo?: Repo }) => {
    el.addEventListener("patchwork:mounted", (event) => {
      const detail = (event as CustomEvent<{ componentId?: string }>).detail;
      if (detail?.componentId === OVERLAY_COMPONENT) setMounted(true);
    });
    setElement(el);
  };

  return (
    <patchwork-view component={OVERLAY_COMPONENT} doc-url={props.url} ref={bind}>
      {/* Its own boundary: a suspense reaching the row's would take this
          element off the page, which unmounts the overlay it's waiting on. */}
      <Suspense fallback={props.loading}>
        <Show
          when={mounted() && element()}
          fallback={gaveUp() ? props.children(props.repo) : props.loading}
        >
          {(el) => <OverlayContents element={el()} children={props.children} />}
        </Show>
      </Suspense>
    </patchwork-view>
  );
}

function OverlayContents(props: {
  element: HTMLElement & { repo?: Repo };
  children: (repo: Repo) => JSX.Element;
}) {
  const changes = subscribe<DraftChanges>(
    props.element,
    { type: "draft:changes" },
    NO_CHANGES
  );
  const containing = createMemo(() => new Set(changes().containing));
  const value: Changes = {
    of(url) {
      const key = canonical(url);
      return changes().changed[key] ?? (containing().has(key) ? "contains" : undefined);
    },
    removedFrom(folderUrl) {
      return changes().removed[canonical(folderUrl)] ?? [];
    },
  };
  return (
    <ChangesContext.Provider value={value}>
      {props.children(props.element.repo!)}
    </ChangesContext.Provider>
  );
}

const CHANGE_LABELS: Record<RowChange, string> = {
  added: "Added",
  modified: "Changed",
  removed: "Removed",
  contains: "Has changes",
};

export function ChangeDot(props: { change: RowChange }) {
  return (
    <span
      class="document-list-item__change"
      data-change={props.change}
      role="img"
      aria-label={CHANGE_LABELS[props.change]}
      title={CHANGE_LABELS[props.change]}
    />
  );
}

export function canonical(url: AutomergeUrl): AutomergeUrl {
  try {
    return stringifyAutomergeUrl({ documentId: parseAutomergeUrl(url).documentId });
  } catch {
    return url;
  }
}
