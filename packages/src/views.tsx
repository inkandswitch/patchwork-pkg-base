// The three ways to look at the registered plugins. Each takes the already
// filtered entries and does its own grouping or sorting.

import { createMemo, For, Show, type JSX } from "solid-js";
import {
  Collapsible,
  Copyable,
  hasActions,
  OriginBadge,
  PluginRow,
  ShadowNote,
  SourceActions,
  SourceLine,
  UnlistedBadge,
} from "./bits.tsx";
import {
  datatypesLabel,
  groupByPackage,
  groupByType,
  sortRows,
  type Enriched,
  type SortKey,
} from "./model.ts";

/** One card per package, with the plugins it registered. */
export function ByPackage(props: { entries: Enriched[] }): JSX.Element {
  const groups = createMemo(() => groupByPackage(props.entries));
  return (
    <ul class="pw-pkg-cards">
      <For each={groups()}>
        {(group) => (
          <li class="pw-pkg-card" data-origin={group.origin}>
            <header class="pw-pkg-card__head">
              <h2 class="pw-pkg-card__name">{group.name}</h2>
              <div class="pw-pkg-card__badges">
                <Show when={group.meta?.version}>
                  <span class="pw-pkg-card__version">v{group.meta!.version}</span>
                </Show>
                <OriginBadge origin={group.origin} />
                <span class="pw-pkg-card__count">
                  {pluginCount(group.plugins)}
                </span>
              </div>
            </header>
            <Show when={group.meta?.name && group.meta?.name !== group.name}>
              <div class="pw-pkg-card__pkgname">{group.meta!.name}</div>
            </Show>
            <div class="pw-pkg-card__source">
              <SourceLine importUrl={group.importUrl} />
            </div>
            <ul class="pw-pkg-plugins">
              <Collapsible
                each={group.plugins}
                render={(plugin) => <PluginRow plugin={plugin} />}
              />
            </ul>
            <Show when={hasActions(group.importUrl, group.origin)}>
              <footer class="pw-pkg-card__foot">
                <SourceActions
                  importUrl={group.importUrl}
                  origin={group.origin}
                />
              </footer>
            </Show>
          </li>
        )}
      </For>
    </ul>
  );
}

// "3 plugins", or "1 of 3 plugins in use" when some are shadowed
function pluginCount(plugins: Enriched[]): string {
  const total = plugins.length;
  const inUse = plugins.filter((p) => p.inUse).length;
  const noun = total === 1 ? "plugin" : "plugins";
  return inUse === total ? `${total} ${noun}` : `${inUse} of ${total} ${noun} in use`;
}

/** One section per registry, i.e. per plugin type. */
export function ByType(props: { entries: Enriched[] }): JSX.Element {
  const groups = createMemo(() => groupByType(props.entries));
  return (
    <div class="pw-pkg-registries">
      <For each={groups()}>
        {(group) => (
          <section class="pw-pkg-registry">
            <header class="pw-pkg-registry__head">
              <h2 class="pw-pkg-registry__name">{group.registry}</h2>
              <span class="pw-pkg-registry__count">{group.plugins.length}</span>
            </header>
            <ul class="pw-pkg-reglist">
              <Collapsible
                each={group.plugins}
                render={(plugin) => <TypeRow plugin={plugin} />}
              />
            </ul>
          </section>
        )}
      </For>
    </div>
  );
}

function TypeRow(props: { plugin: Enriched }): JSX.Element {
  const dts = () => datatypesLabel(props.plugin.supportedDatatypes);
  return (
    <li class="pw-pkg-regitem" data-origin={props.plugin.origin}>
      <div class="pw-pkg-regitem__main">
        <span
          class="pw-pkg-regitem__name"
          classList={{ "is-unlisted": props.plugin.unlisted }}
        >
          {props.plugin.name}
        </span>
        <Copyable
          value={props.plugin.id}
          class="pw-pkg-regitem__id"
          title="Plugin id — click to copy"
        />
        <OriginBadge origin={props.plugin.origin} />
        <Show when={props.plugin.unlisted}>
          <UnlistedBadge />
        </Show>
        <Show when={dts()}>
          <span class="pw-pkg-regitem__supports">supports {dts()}</span>
        </Show>
        <ShadowNote plugin={props.plugin} />
      </div>
      <div class="pw-pkg-regitem__source">
        <span class="pw-pkg-regitem__pkg">{props.plugin.pkgName}</span>
        <SourceLine importUrl={props.plugin.importUrl} />
        <SourceActions
          importUrl={props.plugin.importUrl}
          origin={props.plugin.origin}
        />
      </div>
    </li>
  );
}

const COLUMNS: [SortKey, string][] = [
  ["name", "Name"],
  ["registry", "Registry"],
  ["id", "Id"],
  ["package", "Package"],
  ["origin", "Origin"],
  ["unlisted", "Unlisted"],
];
// only on a host that keeps shadowed registrations: anywhere else, every
// plugin's in use
const IN_USE_COLUMN: [SortKey, string] = ["inUse", "In use"];

/** A flat, sortable table. The sort lives with the caller so it survives view switches. */
export function Table(props: {
  entries: Enriched[];
  sortKey: SortKey;
  sortAsc: boolean;
  onSort: (key: SortKey) => void;
  /** Whether to say which plugins are in use (the host keeps shadowed registrations). */
  inUse?: boolean;
}): JSX.Element {
  const rows = createMemo(() =>
    sortRows(props.entries, props.sortKey, props.sortAsc)
  );
  const columns = () => (props.inUse ? [...COLUMNS, IN_USE_COLUMN] : COLUMNS);
  return (
    <div class="pw-pkg-table-wrap">
      <table class="pw-pkg-table">
        <thead>
          <tr>
            <For each={columns()}>
              {([key, label]) => (
                <th
                  class="pw-pkg-table__th"
                  data-sorted={props.sortKey === key ? "" : undefined}
                  onClick={() => props.onSort(key)}
                >
                  {label}
                  <Show when={props.sortKey === key}>
                    <span class="pw-pkg-table__arrow">
                      {props.sortAsc ? "▲" : "▼"}
                    </span>
                  </Show>
                </th>
              )}
            </For>
            <th class="pw-pkg-table__th pw-pkg-table__th--plain">importUrl</th>
          </tr>
        </thead>
        <tbody>
          <For each={rows()}>
            {(e) => (
              <tr
                class="pw-pkg-table__row"
                classList={{ "is-shadowed": !e.inUse }}
                data-origin={e.origin}
              >
                <td
                  class="pw-pkg-table__name"
                  classList={{ "is-unlisted": e.unlisted }}
                >
                  {e.name}
                  <Show when={datatypesLabel(e.supportedDatatypes)}>
                    <span class="pw-pkg-table__supports">
                      {datatypesLabel(e.supportedDatatypes)}
                    </span>
                  </Show>
                </td>
                <td class="pw-pkg-table__reg">{e.registry}</td>
                <td>
                  <Copyable value={e.id} class="pw-pkg-table__id" />
                </td>
                <td class="pw-pkg-table__pkg">{e.pkgName}</td>
                <td>
                  <OriginBadge origin={e.origin} />
                </td>
                <td class="pw-pkg-table__flag">
                  <Show when={e.unlisted}>
                    <span title="Hidden from new-document menus and pickers">
                      ✓
                    </span>
                  </Show>
                </td>
                <Show when={props.inUse}>
                  <td class="pw-pkg-table__use">
                    <Show when={e.inUse} fallback={<ShadowNote plugin={e} />}>
                      ✓
                    </Show>
                  </td>
                </Show>
                <td class="pw-pkg-table__url">
                  <div class="pw-pkg-source">
                    <SourceLine importUrl={e.importUrl} />
                    <SourceActions importUrl={e.importUrl} origin={e.origin} />
                  </div>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
