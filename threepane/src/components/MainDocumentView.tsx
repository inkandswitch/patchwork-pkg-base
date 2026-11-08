import {
  parseAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type DocumentId,
  type Repo,
} from "@automerge/automerge-repo/slim";
import type { RepoProviderElement } from "@inkandswitch/patchwork-providers";
import {
  getSuggestedImportUrl,
  getType,
  type HasPatchworkMetadata,
} from "@inkandswitch/patchwork-filesystem";
import { getFallbackTool, getRegistry } from "@inkandswitch/patchwork-plugins";
import type { Accessor } from "solid-js";
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
} from "solid-js";
import {
  CantTellCard,
  DeletedCard,
  Finding,
  InvalidUrlCard,
  NoToolCard,
  NotSharedCard,
  ToolFailedCard,
  ToolTimeoutCard,
  UnavailableCard,
} from "./DocumentCards";
import { canOpen, cardText, onKeyhiveOps, pageHive } from "./keyhiveAccess";
import {
  initial,
  isOpen,
  step,
  viewOf,
  type Event as MachineEvent,
  type Resolution,
  type State,
} from "./main-doc-machine";

// how often a doc that isn't shared is checked again, besides on keyhive ops
const RECHECK_NOT_SHARED_MS = 5_000;
// how long a tool's code gets to load before we say it's taking too long
const TOOL_LOAD_TIMEOUT_MS = 15_000;
// how often to look for a repo-provider that hasn't got its repo yet
const REPO_POLL_MS = 100;
// how many transitions the log keeps
const LOG_SIZE = 50;

interface MainDocumentViewProps {
  viewKey: Accessor<string | undefined>;
  selectedDocUrl: Accessor<AutomergeUrl | undefined>;
  toolId: Accessor<string | undefined>;
  // Stable container ref so callers can observe the view's bubbling
  // `patchwork:mounted` / `patchwork:no-tool` events (see useMainDocMounted).
  ref?: (el: HTMLDivElement) => void;
}

/**
 * Renders the main document view with proper keying for remounting
 */
export function MainDocumentView({
  viewKey,
  selectedDocUrl,
  toolId,
  ref,
}: MainDocumentViewProps) {
  return (
    <div class="document-view" ref={(el) => ref?.(el)}>
      <Show when={viewKey()} keyed>
        {(_key) => <DocumentView url={selectedDocUrl()!} toolId={toolId} />}
      </Show>
      {!selectedDocUrl() && (
        <div class="placeholder">Select a document in the sidebar</div>
      )}
    </div>
  );
}

/** One thing that happened to the view: what came in, and where it left us. */
export type LogEntry = { at: number; from: State["kind"]; event: MachineEvent; to: State["kind"] };

/**
 * Finds the doc before handing it to `<patchwork-view>`, so that when it can't
 * be had, or nothing here can open it, we say so in words instead of a `:(`.
 * Everything else (no datatype at all, a tool that throws) is still
 * patchwork-view's to report.
 *
 * What it's doing is one state machine (main-doc-machine.ts). This is its
 * driver: it does the finding, loading, checking and timing that the state
 * calls for, and tells the machine what happened only by sending events. The
 * kind it's in is on the element as `data-doc-state`, and the last few
 * transitions are on its `docStateLog`.
 */
function DocumentView(props: {
  url: AutomergeUrl;
  toolId: Accessor<string | undefined>;
}) {
  const tools = getRegistry("patchwork:tool");
  const [toolsChanged, setToolsChanged] = createSignal(0);
  onCleanup(
    tools.on("changed", () => {
      setToolsChanged((n) => n + 1);
    })
  );

  let disposed = false;
  onCleanup(() => (disposed = true));

  const [state, setState] = createSignal<State>(initial);
  const log: LogEntry[] = [];

  // true when the event changed anything
  function send(event: MachineEvent): boolean {
    if (disposed) return false;
    const from = untrack(state);
    const to = step(from, event);
    if (to === from) return false;
    log.push({ at: Date.now(), from: from.kind, event, to: to.kind });
    if (log.length > LOG_SIZE) log.shift();
    setState(() => to);
    return true;
  }

  // the repo of the nearest `<repo-provider>`, set before the machine hears
  // it's there. a provider can exist before it has its repo
  const [repo, setRepo] = createSignal<Repo>();
  // the doc as last found, to work out its tool from again
  let doc: HasPatchworkMetadata | undefined;
  const [haveDoc, setHaveDoc] = createSignal(false);
  // a "*" tool the reader asked to open this with anyway
  const [peekWith, setPeekWith] = createSignal<string>();
  // the tool that was asked for. patchwork-view is told only this, so it still
  // picks (and later upgrades) its own fallback when none was
  const asked = () => props.toolId() ?? peekWith();

  function resolve(found: HasPatchworkMetadata): Resolution {
    const type = found ? getType(found) : undefined;
    // no datatype at all: patchwork-view says what's wrong with it
    if (!type) return { kind: "open", toolId: undefined };

    let id = asked();
    let anything: { id: string; name: string } | undefined;
    if (!id) {
      const fallback = safely(() => getFallbackTool(found));
      // a "*" tool (raw, inspector) will open anything, but it isn't this
      // datatype's tool: offer it rather than open the doc's insides unasked
      if (fallback && opensOnlyAsAnything(fallback.supportedDatatypes, type))
        anything = { id: fallback.id, name: fallback.name };
      else if (fallback) id = fallback.id;
    }
    if (id && tools.get(id)) return { kind: "open", toolId: id };
    return {
      kind: "no-tool",
      type,
      suggestion: getSuggestedImportUrl(found),
      anything,
    };
  }

  // waiting for the repo: there may be no provider at all, or one that hasn't
  // got its repo yet
  function findRepo(el: HTMLElement) {
    const provider = el.closest<RepoProviderElement>("repo-provider");
    if (!provider) {
      send({ type: "no-provider" });
      return;
    }
    const ready = () => {
      if (!provider.repo) return false;
      setRepo(provider.repo);
      send({ type: "repo-ready" });
      return true;
    };
    if (ready()) return;
    const poll = setInterval(() => {
      if (ready()) clearInterval(poll);
    }, REPO_POLL_MS);
    onCleanup(() => clearInterval(poll));
  }

  // finding: each epoch is one find. a result from an older one is dropped by
  // the machine, whichever way it went
  const findEpoch = createMemo(() => {
    const s = state();
    return s.kind === "finding" || s.kind === "unavailable" ? s.epoch : undefined;
  });
  let unwatchDeleted: (() => void) | undefined;
  onCleanup(() => unwatchDeleted?.());
  async function find(epoch: number, r: Repo) {
    try {
      const handle = await r.find<HasPatchworkMetadata>(props.url);
      if (handle.isDeleted()) {
        send({ type: "deleted", epoch });
        return;
      }
      const found = handle.doc();
      const resolution = resolve(found);
      if (send({ type: "found", epoch, resolution })) {
        doc = found;
        setHaveDoc(true);
        watchDeleted(handle);
      }
    } catch (error) {
      // a url the repo can't even parse won't turn up however long we wait
      if (isInvalidUrlError(error)) send({ type: "invalid", epoch });
      else if (isDeletedError(error)) send({ type: "deleted", epoch });
      else send({ type: "missed", epoch });
    }
  }
  function watchDeleted(handle: DocHandle<HasPatchworkMetadata>) {
    unwatchDeleted?.();
    const onDelete = () => send({ type: "deleted" });
    handle.on("delete", onDelete);
    unwatchDeleted = () => handle.off("delete", onDelete);
  }
  createEffect(() => {
    const epoch = findEpoch();
    const r = repo();
    if (epoch !== undefined && r) void find(epoch, r);
  });

  // an unavailable doc can still turn up: a peer connects and has it, or the
  // sender finishes syncing. the repo's progress says when, so look again then
  createEffect(() => {
    const r = repo();
    if (!r) return;
    const progress = findProgress(r, props.url);
    const unwatch = progress?.subscribe((p) => {
      if (p.state === "ready" && untrack(state).kind === "unavailable")
        send({ type: "look" });
    });
    onCleanup(() => unwatch?.());
  });

  // asking again: once the repo has settled on "unavailable", `find` answers
  // from that verdict without asking anyone. so first have it ask the sync
  // server afresh (the round starts a macrotask later), then look a moment
  // after. resyncing, rather than deleting the stale handle, matters under a
  // remapping provider: its `delete` goes to the base repo with the url we
  // were given, which there may be another doc's. the card stays up while
  // we ask, rather than flickering away and back
  function askAgain() {
    const r = repo() as
      | (Repo & { resyncSubduction?: (documentId: DocumentId) => void })
      | undefined;
    if (!r || typeof r.resyncSubduction !== "function") return;
    try {
      r.resyncSubduction(parseAutomergeUrl(props.url).documentId);
    } catch {}
  }
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(retryTimer));
  function retry(after = 1_000) {
    askAgain();
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => send({ type: "look" }), after);
  }

  // and ask again by ourselves, every so often, for as long as the card is up.
  // nothing else would notice a sender who finishes syncing while we sit here
  // connected: the server doesn't tell us about a doc we already gave up on.
  // 3s, 6s, 12s, then every 30s
  const misses = createMemo(() => {
    const s = state();
    return s.kind === "unavailable" ? s.misses : 0;
  });
  createEffect(() => {
    const n = misses();
    if (n === 0) return;
    retry(Math.min(30_000, 3_000 * 2 ** (n - 1)));
    onCleanup(() => clearTimeout(retryTimer));
  });

  // the tools changed, or a "*" tool was asked for: work out the doc's tool again
  createEffect(() => {
    toolsChanged();
    asked();
    if (haveDoc() && doc) send({ type: "resolved", resolution: resolve(doc) });
  });

  // the tool the doc opens with is loaded here too: a tool whose code fails to
  // load leaves patchwork-view on its loading dot for good, so a failure gets
  // a card instead, and one that never settles gets a timeout. each try is
  // keyed by tool and attempt; a late answer for an old one is the machine's
  // to drop
  const loading = createMemo(() => {
    const s = state();
    return isOpen(s) && s.tool === "loading" && s.toolId
      ? `${s.attempt}:${s.toolId}`
      : undefined;
  });
  createEffect(() => {
    if (!loading()) return;
    const s = untrack(state);
    if (!isOpen(s) || !s.toolId) return;
    const { toolId, attempt } = s;
    const timer = setTimeout(
      () => send({ type: "tool-timeout", toolId, attempt }),
      TOOL_LOAD_TIMEOUT_MS
    );
    onCleanup(() => clearTimeout(timer));
    // not stopped when this effect goes: a load that comes in after the
    // timeout is still worth knowing
    tools.load(toolId).then(
      () => send({ type: "tool-loaded", toolId, attempt }),
      (error) =>
        send({
          type: "tool-failed",
          toolId,
          attempt,
          message: error instanceof Error ? error.message : String(error),
        })
    );
  });

  // a doc that's here but not shared with this identity: patchwork-view's
  // gate holds the tool back and the pane stays blank, so say so. checked
  // again whenever keyhive takes in ops, so a share that lands clears it
  const hive = pageHive();
  const checking = createMemo(() => isOpen(state()));
  let accessSeq = 0;
  createEffect(() => {
    if (!hive || !checking()) return;
    const url = props.url;
    let live = true;
    const check = () => {
      const seq = ++accessSeq;
      void canOpen(hive, url).then((result) => {
        if (live) send({ type: "access", seq, result });
      });
    };
    check();
    const off = onKeyhiveOps(hive, check);
    // a doc going public isn't an op this identity's keyhive hears of, so
    // while it says no (or can't say), look again now and then too
    const poll = setInterval(() => {
      const s = untrack(state);
      if (isOpen(s) && (s.access === "not-shared" || s.access === "unknown"))
        check();
    }, RECHECK_NOT_SHARED_MS);
    onCleanup(() => {
      live = false;
      off();
      clearInterval(poll);
    });
  });

  // the view underneath is kept from unavailable through to open, so whatever
  // it was doing to recover carries on. it follows tool-id by itself
  const viewNumber = createMemo(() => viewOf(state()));

  const kind = () => state().kind;

  return (
    <div
      class="doc-stack"
      data-doc-state={kind()}
      ref={(el) => {
        (el as HTMLElement & { docStateLog?: () => LogEntry[] }).docStateLog =
          () => log.slice();
        const onMounted = (event: Event) => {
          const detail = (event as CustomEvent<{ url?: string }>).detail;
          if (detail?.url && detail.url !== props.url) return;
          send({ type: "mounted" });
        };
        el.addEventListener("patchwork:mounted", onMounted);
        onCleanup(() => el.removeEventListener("patchwork:mounted", onMounted));
        onMount(() => findRepo(el));
      }}
    >
      <Show when={viewNumber() !== undefined ? viewNumber()! + 1 : undefined} keyed>
        {(_view) => <patchwork-view doc-url={props.url} tool-id={asked()} />}
      </Show>
      <Switch>
        <Match when={kind() === "waiting-repo"}>
          <Finding label="getting ready…" />
        </Match>
        <Match when={kind() === "finding"}>
          <Finding />
        </Match>
        <Match when={kind() === "unavailable"}>
          <UnavailableCard url={props.url} repo={repo()!} onRetry={retry} />
        </Match>
        <Match when={kind() === "invalid"}>
          <InvalidUrlCard url={props.url} />
        </Match>
        <Match when={kind() === "deleted"}>
          <DeletedCard url={props.url} />
        </Match>
        <Match when={noTool(state())}>
          {(v) => (
            <NoToolCard
              url={props.url}
              type={v().type}
              suggestion={v().suggestion}
              anything={v().anything}
              onPeek={setPeekWith}
              repo={repo()!}
            />
          )}
        </Match>
        <Match when={kind() === "not-shared"}>
          <NotSharedCard url={props.url} card={hive && cardText(hive)} />
        </Match>
        <Match when={kind() === "cant-tell"}>
          <CantTellCard url={props.url} />
        </Match>
        <Match when={failedTool(state())}>
          {(failed) => (
            <ToolFailedCard
              url={props.url}
              name={tools.get(failed().id)?.name ?? failed().id}
              error={failed().message}
              onRetry={async () => void send({ type: "retry-tool" })}
            />
          )}
        </Match>
        <Match when={timedOutTool(state())}>
          {(id) => (
            <ToolTimeoutCard
              url={props.url}
              name={tools.get(id())?.name ?? id()}
              onRetry={() => send({ type: "retry-tool" })}
            />
          )}
        </Match>
      </Switch>
    </div>
  );
}

const noTool = (s: State) => (s.kind === "no-tool" ? s : undefined);
const failedTool = (s: State) =>
  s.kind === "tool-failed" && s.toolId
    ? { id: s.toolId, message: s.error ?? "it didn't say why" }
    : undefined;
const timedOutTool = (s: State) =>
  s.kind === "tool-timeout" ? s.toolId : undefined;

// the repo's live progress for a doc, where the repo has one (a remapping
// overlay or an older repo might not)
type Progress = {
  peek(): { state: string };
  subscribe(cb: (p: { state: string }) => void): () => void;
};
function findProgress(repo: Repo, url: AutomergeUrl): Progress | undefined {
  const withProgress = (
    repo as unknown as { findWithProgress?: (url: AutomergeUrl) => Progress }
  ).findWithProgress;
  if (typeof withProgress !== "function") return undefined;
  return safely(() => {
    const p = withProgress.call(repo, url);
    return typeof p?.subscribe === "function" && typeof p?.peek === "function"
      ? p
      : undefined;
  });
}

// the repo says so when it can't parse a url: "Invalid AutomergeUrl: …" from
// interpretAsDocumentId, "Invalid document URL: …" from parseAutomergeUrl.
// we go by what the repo says rather than checking the url ourselves, so a
// form the host's repo accepts is never turned away here
function isInvalidUrlError(error: unknown): boolean {
  const message = (error as Error)?.message ?? String(error);
  return /invalid (automergeurl|document url|documentid|document id)/i.test(message);
}

// find() rejects with this for a doc that was deleted
function isDeletedError(error: unknown): boolean {
  const message = (error as Error)?.message ?? String(error);
  return /was deleted/i.test(message);
}

// whether a tool takes `type` only because it takes "*"
function opensOnlyAsAnything(
  supported: "*" | string[] | undefined,
  type: string
): boolean {
  const list = supported === "*" ? ["*"] : (supported ?? []);
  return list.includes("*") && !list.includes(type);
}

function safely<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
