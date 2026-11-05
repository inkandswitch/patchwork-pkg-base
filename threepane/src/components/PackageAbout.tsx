import type { Repo } from "@automerge/automerge-repo/slim";
import {
  createResource,
  createSignal,
  For,
  Match,
  onMount,
  Show,
  Switch,
} from "solid-js";
import {
  askPlugins,
  isAutomergeUrl,
  pinnedHeads,
  readHistory,
  type PackageClaims,
  type PluginClaim,
  type Writer,
} from "./packageInfo";

let popovers = 0;

/** The one line a card says about a suggested package, from its package.json. */
export function PackageLine(props: { claims: PackageClaims | undefined }) {
  return (
    <Show when={props.claims && (props.claims.title || props.claims.name)}>
      <span class="pkg-line">
        <strong>{props.claims!.title ?? props.claims!.name}</strong>
        <Show when={props.claims!.version}>
          {(v) => <span class="pkg-line__version"> v{v()}</span>}
        </Show>
        <Show when={props.claims!.description}>
          {(d) => <span class="pkg-line__description"> — {d()}</span>}
        </Show>
      </span>
    </Show>
  );
}

/**
 * A button that pops up what's known about a suggested package, in two
 * halves: what the package says about itself (which it could make up), and
 * what we can see from our own repo (its url, heads, and which actors have
 * written to its folder doc).
 */
export function PackageAbout(props: {
  url: string;
  repo: Repo;
  claims: PackageClaims | undefined;
  claimsLoading: boolean;
}) {
  const id = `pkg-about-${++popovers}`;
  const automerge = isAutomergeUrl(props.url);
  const pinned = pinnedHeads(props.url);

  // the history is read the first time the popover opens, not before
  const [opened, setOpened] = createSignal(false);
  const [history] = createResource(
    () => (opened() && automerge ? props.url : undefined),
    (url) => readHistory(props.repo, url)
  );

  // the plugins it reports when it's run, once the reader has asked
  const [asking, setAsking] = createSignal(false);
  const [asked, setAsked] = createSignal<PluginClaim[]>();
  const [askFailed, setAskFailed] = createSignal<string>();
  async function ask() {
    const ok = window.confirm(
      `To find out what this package brings, its code has to run.\n\n` +
        `${props.url}\n\n` +
        `It runs in a background worker, not in this page, and reports back ` +
        `the plugins it says it has. Nothing is added to this page. It can ` +
        `still use the network, and the data this site keeps in your ` +
        `browser, your documents included. Only run it if you trust whoever ` +
        `sent you this document.\n\n` +
        `Run it?`
    );
    if (!ok) return;
    setAskFailed(undefined);
    setAsking(true);
    try {
      setAsked(await askPlugins(props.url));
    } catch (error) {
      setAskFailed((error as Error)?.message ?? String(error));
    } finally {
      setAsking(false);
    }
  }

  let popover!: HTMLDivElement;
  onMount(() => {
    popover.addEventListener("toggle", (event) => {
      if ((event as ToggleEvent).newState === "open") setOpened(true);
    });
  });

  return (
    <>
      <button
        type="button"
        class="doc-card__button"
        popovertarget={id}
      >
        about this package
      </button>
      <div class="pkg-about" id={id} popover="auto" ref={popover}>
        <header class="pkg-about__header">
          <h3 class="doc-card__rough">about this package</h3>
          <button
            type="button"
            class="doc-card__link pkg-about__close"
            popovertarget={id}
            popovertargetaction="hide"
            aria-label="close"
          >
            ×
          </button>
        </header>

        <section class="pkg-about__section pkg-about__section--claims">
          <h4>what it says about itself</h4>
          <p class="pkg-about__caveat">
            the package wrote this about itself. it could say anything, and
            nothing checks it.
          </p>
          <Switch>
            <Match when={props.claimsLoading}>
              <p class="pkg-about__quiet">reading its package.json…</p>
            </Match>
            <Match when={!props.claims}>
              <p class="pkg-about__quiet">
                we couldn't read a package.json for it.
              </p>
            </Match>
            <Match when={props.claims}>
              {(claims) => (
                <dl class="pkg-about__facts">
                  <Fact label="name" value={claims().name} />
                  <Fact label="title" value={claims().title} />
                  <Fact label="version" value={claims().version} />
                  <Fact label="author" value={claims().author} />
                  <Fact label="description" value={claims().description} />
                  <Show when={claims().plugins}>
                    {(plugins) => (
                      <>
                        <dt>plugins it lists</dt>
                        <dd>
                          <Plugins plugins={plugins()} />
                        </dd>
                      </>
                    )}
                  </Show>
                </dl>
              )}
            </Match>
          </Switch>

          <Show
            when={automerge}
            fallback={
              <p class="pkg-about__quiet">
                it lives at a web address, so the only way to ask it what it
                brings is to load it.
              </p>
            }
          >
            <Show
              when={asked()}
              fallback={
                <div class="pkg-about__ask">
                  <button
                    type="button"
                    class="doc-card__button"
                    disabled={asking()}
                    onClick={() => void ask()}
                  >
                    {asking() ? "asking…" : "ask it what it brings"}
                  </button>
                  <Show when={askFailed()}>
                    {(why) => (
                      <p class="doc-card__notice">it didn't say: {why()}</p>
                    )}
                  </Show>
                </div>
              }
            >
              {(plugins) => (
                <dl class="pkg-about__facts">
                  <dt>when asked, it said it brings</dt>
                  <dd>
                    <Plugins plugins={plugins()} />
                  </dd>
                </dl>
              )}
            </Show>
          </Show>
        </section>

        <section class="pkg-about__section">
          <h4>what we can see</h4>
          <dl class="pkg-about__facts">
            <dt>address</dt>
            <dd>
              <code class="doc-card__code doc-card__url">{props.url}</code>
            </dd>
            <Show when={pinned.length}>
              <dt>pinned to</dt>
              <dd>
                <Heads heads={pinned} />
              </dd>
            </Show>
            <Show when={automerge}>
              <Switch>
                <Match when={history.loading}>
                  <dt>history</dt>
                  <dd class="pkg-about__quiet">reading…</dd>
                </Match>
                <Match when={history.error}>
                  <dt>history</dt>
                  <dd class="pkg-about__quiet">
                    we couldn't get the package's folder to look at.
                  </dd>
                </Match>
                <Match when={history()}>
                  {(h) => (
                    <>
                      <dt>its heads now</dt>
                      <dd>
                        <Heads heads={h().heads} />
                      </dd>
                      <dt>history</dt>
                      <dd>
                        {h().changes} {h().changes === 1 ? "change" : "changes"}{" "}
                        from {h().writers.length}{" "}
                        {h().writers.length === 1 ? "writer" : "writers"}
                        <Writers writers={h().writers} />
                        <p class="pkg-about__caveat">
                          a writer is an automerge actor: a device or session
                          that made changes, not a person. one person can be
                          several writers. this is only the package folder's
                          history; each file in it has its own.
                        </p>
                      </dd>
                    </>
                  )}
                </Match>
              </Switch>
            </Show>
          </dl>
        </section>
      </div>
    </>
  );
}

function Fact(props: { label: string; value: string | undefined }) {
  return (
    <Show when={props.value}>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </Show>
  );
}

function Plugins(props: { plugins: PluginClaim[] }) {
  return (
    <Show when={props.plugins.length} fallback={<span>nothing</span>}>
      <ul class="pkg-about__list">
        <For each={props.plugins}>
          {(p) => (
            <li>
              {p.name ?? p.id ?? "(unnamed)"}
              <Show when={p.type}>
                {(t) => <span class="pkg-about__quiet"> · {t()}</span>}
              </Show>
              <Show when={p.supportedDatatypes?.length}>
                <span class="pkg-about__quiet">
                  {" "}
                  for {p.supportedDatatypes!.join(", ")}
                </span>
              </Show>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}

function Heads(props: { heads: string[] }) {
  return (
    <span class="pkg-about__heads">
      <For each={props.heads}>
        {(head) => (
          <code class="doc-card__code" title={head}>
            {head.slice(0, 7)}
          </code>
        )}
      </For>
    </span>
  );
}

const MOST_WRITERS = 6;

function Writers(props: { writers: Writer[] }) {
  const more = () => props.writers.length - MOST_WRITERS;
  return (
    <ul class="pkg-about__list">
      <For each={props.writers.slice(0, MOST_WRITERS)}>
        {(w) => (
          <li>
            <code class="doc-card__code" title={w.actor}>
              {w.actor.slice(0, 8)}
            </code>{" "}
            {w.changes} {w.changes === 1 ? "change" : "changes"}
            <Show when={w.last}>
              <span class="pkg-about__quiet"> · {span(w)}</span>
            </Show>
          </li>
        )}
      </For>
      <Show when={more() > 0}>
        <li class="pkg-about__quiet">and {more()} more</li>
      </Show>
    </ul>
  );
}

function day(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function span(w: Writer): string {
  const last = day(w.last);
  const first = w.first ? day(w.first) : last;
  return first === last ? last : `${first} – ${last}`;
}
