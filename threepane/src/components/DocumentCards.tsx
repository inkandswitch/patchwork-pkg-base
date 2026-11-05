import type { AutomergeUrl, Repo } from "@automerge/automerge-repo/slim";
import { importPackage } from "@inkandswitch/patchwork-filesystem";
import { registerPlugins } from "@inkandswitch/patchwork-plugins";
import type { JSX } from "solid-js";
import {
  createResource,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { PackageAbout, PackageLine } from "./PackageAbout";
import { readClaims } from "./packageInfo";

/**
 * The cards the main view shows in place of a doc it can't show: the one
 * lattice and knit draw (a sheet with a hand-drawn serif heading), minus the
 * wobble. Each settles the main view the way patchwork-view would, so the
 * sidebar widgets don't sit waiting on a doc that isn't coming.
 */
function Card(props: {
  url: AutomergeUrl;
  title: string;
  children: JSX.Element;
}) {
  let el!: HTMLDivElement;
  onMount(() => {
    el.dispatchEvent(
      new CustomEvent("patchwork:no-tool", {
        bubbles: true,
        composed: true,
        detail: { url: props.url },
      })
    );
  });
  return (
    <div class="doc-card" ref={el}>
      <svg class="doc-card__defs" aria-hidden="true">
        <filter id="doc-card-rough">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.04"
            numOctaves="2"
            seed="1"
          />
          <feDisplacementMap in="SourceGraphic" scale="1.4" />
        </filter>
      </svg>
      <div class="doc-card__sheet">
        <h2 class="doc-card__rough">{props.title}</h2>
        {props.children}
      </div>
    </div>
  );
}

/** Still looking: a quiet dot, and only once it's been a moment. */
export function Finding() {
  return (
    <div class="doc-card doc-card--finding" role="status">
      <span class="doc-card__dot" />
      <span class="doc-card__finding-label">finding this doc…</span>
    </div>
  );
}

/**
 * A doc whose datatype nothing here opens. If the doc names a package that
 * might, offer to load it: that runs code the doc points at, so it takes a
 * click and then a confirm that says so.
 */
export function NoToolCard(props: {
  url: AutomergeUrl;
  type: string;
  suggestion: string | undefined;
  anything: { id: string; name: string } | undefined;
  onPeek: (toolId: string) => void;
  repo: Repo;
}) {
  const [loading, setLoading] = createSignal(false);
  const [failed, setFailed] = createSignal<string>();
  // what its package.json says: fetched, never run, so it's read straight away
  const [claims] = createResource(
    () => props.suggestion,
    (url) => readClaims(url).catch(() => undefined)
  );

  async function load(url: string) {
    const ok = window.confirm(
      `This document suggests a package to open it with:\n\n` +
        `${url}\n\n` +
        `Loading it runs its code in this page, where it can read and ` +
        `change your documents. Only load it if you trust whoever sent you ` +
        `this document.\n\n` +
        `Load it?`
    );
    if (!ok) return;
    setFailed(undefined);
    setLoading(true);
    try {
      const mod = await importPackage(url);
      if (!Array.isArray(mod?.plugins))
        throw new Error("it doesn't export any plugins");
      // once its tool registers, the main view swaps this card for it
      registerPlugins(mod.plugins, url);
    } catch (error) {
      console.error(`couldn't load the package at ${url}`, error);
      setFailed((error as Error)?.message ?? String(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card url={props.url} title="no tool for this">
      <p>
        it's a <code class="doc-card__code">{props.type}</code>, and nothing
        here knows how to open one yet.
      </p>
      <Show
        when={props.suggestion}
        fallback={<p>if a package brings a tool for it, it'll open right here.</p>}
      >
        {(url) => (
          <>
            <p>
              the doc suggests a package that might:
              <br />
              <PackageLine claims={claims()} />
              <Show when={claims() && (claims()!.title || claims()!.name)}>
                <br />
              </Show>
              <code class="doc-card__code doc-card__url">{url()}</code>
            </p>
            <div class="doc-card__actions">
              <button
                type="button"
                class="doc-card__button doc-card__button--primary"
                disabled={loading()}
                onClick={() => void load(url())}
              >
                {loading() ? "loading…" : "load it"}
              </button>
              <PackageAbout
                url={url()}
                repo={props.repo}
                claims={claims()}
                claimsLoading={claims.loading}
              />
            </div>
            <Show when={failed()}>
              {(why) => (
                <p class="doc-card__notice">couldn't load it: {why()}</p>
              )}
            </Show>
          </>
        )}
      </Show>
      <Show when={props.anything}>
        {(tool) => (
          <p class="doc-card__aside">
            or{" "}
            <button
              type="button"
              class="doc-card__link"
              onClick={() => props.onPeek(tool().id)}
            >
              look inside with {tool().name}
            </button>
          </p>
        )}
      </Show>
    </Card>
  );
}

// the bits of a subduction repo we read the sync server's connection from;
// absent on repos without one
type Connected = {
  isSubductionConnected?: () => boolean;
  on?: (event: "subduction-connection", cb: (p: { connected: boolean }) => void) => void;
  off?: (event: "subduction-connection", cb: (p: { connected: boolean }) => void) => void;
};

/**
 * A doc the repo couldn't get from anywhere. Says why that tends to happen,
 * and how the sync server connection looks from here, when the repo knows.
 */
export function UnavailableCard(props: {
  url: AutomergeUrl;
  repo: Repo;
  onRetry: () => void;
}) {
  const repo = props.repo as unknown as Connected;
  const knowsConnection = typeof repo.isSubductionConnected === "function";
  const [connected, setConnected] = createSignal(
    knowsConnection ? repo.isSubductionConnected!() : undefined
  );
  // back online: worth asking again
  const update = (now: boolean) => {
    const was = connected();
    setConnected(now);
    if (now && was === false) props.onRetry();
  };
  if (knowsConnection && repo.on && repo.off) {
    const onConnection = (p: { connected: boolean }) => update(p.connected);
    repo.on("subduction-connection", onConnection);
    onCleanup(() => repo.off!("subduction-connection", onConnection));
  }
  // the event only fires when the connection flips, and a wrapped repo might
  // not pass it on, so read it again every so often too: the readout should
  // never be telling you about a while ago
  if (knowsConnection) {
    const poll = setInterval(() => update(repo.isSubductionConnected!()), 2000);
    onCleanup(() => clearInterval(poll));
  }

  return (
    <Card url={props.url} title="can't load this doc">
      <p>we couldn't get it from anywhere we looked. that might mean:</p>
      <ul class="doc-card__reasons">
        <li>the person who sent you the link hasn't given you access yet</li>
        <li>it hasn't finished syncing from their device yet</li>
        <li>something's wrong with the sync server</li>
      </ul>
      <Show when={connected() !== undefined}>
        <p
          class="doc-card__readout"
          role="status"
          data-connected={connected() ? "" : undefined}
        >
          <span class="doc-card__readout-label">Sync Server Status:</span>{" "}
          <span class="doc-card__readout-value">
            (<span class="doc-card__status-dot" />){" "}
            {connected() ? "Connected" : "Disconnected"}
          </span>
        </p>
      </Show>
      <p>we'll keep looking. if it turns up, it'll open right here.</p>
      <p class="doc-card__aside">
        <code class="doc-card__code doc-card__url">{props.url}</code>
      </p>
    </Card>
  );
}

/**
 * A url the repo can't read as a doc's address at all. Nothing will make it
 * load, so there's nothing to try again: the link itself needs fixing.
 */
export function InvalidUrlCard(props: { url: AutomergeUrl }) {
  return (
    <Card url={props.url} title="this link is broken">
      <p>
        a bit of it got lost or changed on the way here, so it can't point at
        any doc. maybe a character dropped when it was copied, or the link got
        cut short.
      </p>
      <p>if someone sent it to you, ask them for the link again.</p>
      <p class="doc-card__aside">
        <code class="doc-card__code doc-card__url">{props.url}</code>
      </p>
    </Card>
  );
}
