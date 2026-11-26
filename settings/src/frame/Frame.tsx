// what used to be the frame configurator: which frame the studio is, which
// tools sit in a document's title bar, and which tabs the context sidebar
// has. the frame's on the account doc (`frameToolId`); the title bar and the
// context sidebar are in threepane's config doc (`account.tools.threepane`)
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { DocHandle } from "@automerge/automerge-repo/slim";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { useDocument } from "solid-automerge";
import type { AccountDoc } from "../you/contact";
import { AddPicker } from "./AddPicker";
import { ItemMenu } from "./ItemMenu";
import {
  contextLane,
  editContext,
  editTitlebar,
  slotId,
  type ThreepaneConfigDoc,
} from "./lanes";

type Describable = {
  id: string;
  name?: string;
  tags?: string[];
  unlisted?: boolean;
};
type Option = { id: string; name: string };

const FRAME_RELOAD_DELAY_MS = 250;

function useRegistry(type: string) {
  const registry = getRegistry(type);
  const read = () =>
    ((registry.all?.() ?? []) as unknown as Describable[]).slice();
  const [tools, setTools] = createSignal(read());
  const off = registry.on("changed" as any, () => {
    setTools(read());
  });
  onCleanup(() => (off as () => void)?.());
  return tools;
}

// `unlisted` ones too, for the context sidebar and the title bar, which show
// every tagged tool whether it's listed or not (every titlebar tool is
// unlisted, so it stays out of "Open with")
const tagged = (
  tools: Describable[],
  tag: string,
  { unlisted = false } = {}
): Option[] =>
  tools
    .filter(
      (tool) => (unlisted || !tool.unlisted) && (tool.tags ?? []).includes(tag)
    )
    .map((tool) => ({ id: tool.id, name: tool.name || tool.id }))
    .sort((a, b) => a.name.localeCompare(b.name));

// the frame this page is in: the nearest patchwork-view around it that's one
// of the frames. an account that's never chosen has no frameToolId, but it's
// still in one
function runningFrame(
  element: HTMLElement,
  frames: Option[]
): string | undefined {
  const ids = new Set(frames.map((frame) => frame.id));
  for (let el = element.parentElement; el; el = el.parentElement) {
    const id =
      el.tagName === "PATCHWORK-VIEW" ? el.getAttribute("tool-id") : null;
    if (id && ids.has(id)) return id;
  }
}

export function Frame(props: {
  element: HTMLElement;
  handle: DocHandle<AccountDoc>;
  account: () => AccountDoc | undefined;
  repo: { flush(): Promise<unknown> };
}) {
  const tools = useRegistry("patchwork:tool");
  // title bar slots can be tools or components, listed or not: any of them
  // has a better name than its id
  const components = useRegistry("patchwork:component");
  const names = createMemo(
    () =>
      new Map(
        [...components(), ...tools()].map((plugin) => [
          plugin.id,
          plugin.name || plugin.id,
        ])
      )
  );
  const frames = createMemo(() => tagged(tools(), "frame-tool"));
  const current = () =>
    props.account()?.frameToolId ?? runningFrame(props.element, frames());
  const nameOf = (id: string) => names().get(id) ?? id;

  const [threepane, threepaneHandle] = useDocument<ThreepaneConfigDoc>(
    () => props.account()?.tools?.threepane
  );

  const titlebarItems = createMemo(() => {
    const hidden = new Set((threepane()?.doctitle?.hidden ?? []).map(String));
    return (threepane()?.doctitle?.tools ?? []).map(slotId).map((id) => ({
      id,
      name: nameOf(id),
      hidden: hidden.has(id),
    }));
  });
  const titlebarOptions = createMemo(() => {
    const present = new Set(titlebarItems().map((item) => item.id));
    return tagged(tools(), "titlebar-tool", { unlisted: true }).filter(
      (option) => !present.has(option.id)
    );
  });

  // every component tagged "context-tool", with the person's edits on top.
  // what's left to add is the tagged ones they took out
  const contextTagged = createMemo(() =>
    tagged(components(), "context-tool", { unlisted: true })
  );
  const contextItems = createMemo(() => {
    const config = threepane()?.context;
    const hidden = new Set((config?.hidden ?? []).map(String));
    // in bar order, the hidden ones where they'd be if they weren't
    const { shown } = contextLane(
      contextTagged(),
      { added: config?.added, removed: config?.removed },
      nameOf
    );
    return shown.map((item) => ({ ...item, hidden: hidden.has(item.id) }));
  });
  const contextOptions = createMemo(() => {
    const present = new Set(contextItems().map((item) => item.id));
    return contextTagged().filter((option) => !present.has(option.id));
  });

  function chooseFrame(id: string) {
    if (current() === id) return;
    props.handle.change((doc) => {
      doc.frameToolId = id;
    });
    // the frame's what everything's in, so it takes a reload
    setTimeout(async () => {
      await props.repo.flush().catch(() => null);
      window.location.reload();
    }, FRAME_RELOAD_DELAY_MS);
  }

  return (
    <>
      <Show when={frames().length}>
        <section class="settings-section" aria-labelledby="settings-frame">
          <h2 id="settings-frame">Frame</h2>
          <div class="settings-group">
            <div class="settings-group-block">
              <div
                class="settings-segmented"
                role="radiogroup"
                aria-label="Frame"
              >
                <For each={frames()}>
                  {(frame) => (
                    <button
                      type="button"
                      class="settings-segment"
                      role="radio"
                      aria-checked={current() === frame.id}
                      onClick={() => chooseFrame(frame.id)}
                    >
                      {frame.name}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </div>
        </section>
      </Show>

      <Show when={threepaneHandle()}>
        {(handle) => (
          <>
            <section
              class="settings-section"
              aria-labelledby="settings-titlebar"
            >
              <h2 id="settings-titlebar">Title bar</h2>
              <div class="settings-group">
                <div class="settings-group-block">
                  <Strip
                    items={titlebarItems()}
                    options={titlebarOptions()}
                    onAdd={(id) =>
                      handle().change((doc) =>
                        editTitlebar(doc, { action: "add", id })
                      )
                    }
                    onRemove={(id) =>
                      handle().change((doc) =>
                        editTitlebar(doc, { action: "remove", id })
                      )
                    }
                    onHidden={(id, hidden) =>
                      handle().change((doc) =>
                        editTitlebar(doc, {
                          action: hidden ? "hide" : "show",
                          id,
                        })
                      )
                    }
                    onMove={(from, to) =>
                      handle().change((doc) =>
                        editTitlebar(doc, { action: "move", from, to })
                      )
                    }
                  />
                </div>
              </div>
            </section>

            <section
              class="settings-section"
              aria-labelledby="settings-context"
            >
              <h2 id="settings-context">Context sidebar</h2>
              <div class="settings-group">
                <div class="settings-group-block">
                  <Strip
                    items={contextItems()}
                    options={contextOptions()}
                    onAdd={(id) =>
                      handle().change((doc) => editContext(doc, "add", id))
                    }
                    onRemove={(id) =>
                      handle().change((doc) => editContext(doc, "remove", id))
                    }
                    onHidden={(id, hidden) =>
                      handle().change((doc) =>
                        editContext(doc, hidden ? "hide" : "show", id)
                      )
                    }
                  />
                </div>
              </div>
            </section>
          </>
        )}
      </Show>
    </>
  );
}

type StripItem = Option & { hidden?: boolean };

// a row of tools: each one's × has a menu to hide it (still there, just not
// shown) or take it out, and "Add…" puts one in. drag to reorder, when the lane has an order to keep.
// ids are kept as they are, even ones whose plugin hasn't registered yet
// (they're shown by id), so a slow plugin isn't dropped by a rewrite
function Strip(props: {
  items: StripItem[];
  options: Option[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onHidden: (id: string, hidden: boolean) => void;
  onMove?: (from: number, to: number) => void;
}) {
  const [from, setFrom] = createSignal<number | null>(null);
  const [to, setTo] = createSignal<number | null>(null);

  // `dropped` is false when the drag was called off: Escape, or let go
  // somewhere that isn't the strip. Then nothing moves.
  function drop(dropped: boolean) {
    const a = from();
    const b = to();
    setFrom(null);
    setTo(null);
    if (!dropped || a == null || b == null || a === b) return;
    props.onMove?.(a, b);
  }

  return (
    <div class="settings-strip">
      <ol
        class="settings-strip-items"
        // the whole row takes the drop, gaps between items included, so
        // letting go anywhere on it counts and anywhere else cancels
        onDragOver={(event) => {
          if (from() !== null) event.preventDefault();
        }}
      >
        <For each={props.items}>
          {(item, index) => (
            <li
              class="settings-strip-item"
              draggable={!!props.onMove}
              data-fixed={props.onMove ? undefined : ""}
              data-hidden={item.hidden ? "" : undefined}
              data-dragging={from() === index() ? "" : undefined}
              data-over={
                to() === index() && from() !== index() ? "" : undefined
              }
              onDragStart={(event) => {
                if (!props.onMove) return;
                event.dataTransfer!.effectAllowed = "move";
                setFrom(index());
                setTo(index());
              }}
              onDragOver={(event) => {
                if (from() === null) return;
                event.preventDefault();
                event.dataTransfer!.dropEffect = "move";
                setTo(index());
              }}
              onDragEnd={(event) =>
                drop(event.dataTransfer?.dropEffect !== "none")
              }
            >
              <span class="settings-strip-name">{item.name}</span>
              <ItemMenu
                name={item.name}
                hidden={item.hidden}
                onHidden={(hidden) => props.onHidden(item.id, hidden)}
                onRemove={() => props.onRemove(item.id)}
              />
            </li>
          )}
        </For>
      </ol>
      <AddPicker options={props.options} onPick={props.onAdd} />
    </div>
  );
}
