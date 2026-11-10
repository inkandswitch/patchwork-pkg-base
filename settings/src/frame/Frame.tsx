// what used to be the frame configurator: which frame the studio is, and
// which tools sit in a document's title bar. the frame's on the account doc
// (`frameToolId`); the title bar's in threepane's config doc
// (`account.tools.threepane`), as frame-configurator kept them
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { DocHandle } from "@automerge/automerge-repo/slim";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { useDocument } from "solid-automerge";
import type { AccountDoc } from "../you/contact";

type ToolSlot = [toolId: string, docId: string] | string;
type ThreepaneConfigDoc = { doctitle?: { tools?: ToolSlot[] } };
type Describable = { id: string; name?: string; tags?: string[]; unlisted?: boolean };
type Option = { id: string; name: string };

const FRAME_RELOAD_DELAY_MS = 250;

function useRegistry(type: string) {
  const registry = getRegistry(type);
  const read = () => ((registry.all?.() ?? []) as unknown as Describable[]).slice();
  const [tools, setTools] = createSignal(read());
  const off = registry.on("changed" as any, () => {
    setTools(read());
  });
  onCleanup(() => (off as () => void)?.());
  return tools;
}

const tagged = (tools: Describable[], tag: string): Option[] =>
  tools
    .filter((tool) => !tool.unlisted && (tool.tags ?? []).includes(tag))
    .map((tool) => ({ id: tool.id, name: tool.name || tool.id }))
    .sort((a, b) => a.name.localeCompare(b.name));

const slotId = (slot: ToolSlot) => (typeof slot === "string" ? slot : slot[0]);

// the frame this page is in: the nearest patchwork-view around it that's one
// of the frames. an account that's never chosen has no frameToolId, but it's
// still in one
function runningFrame(element: HTMLElement, frames: Option[]): string | undefined {
  const ids = new Set(frames.map((frame) => frame.id));
  for (let el = element.parentElement; el; el = el.parentElement) {
    const id = el.tagName === "PATCHWORK-VIEW" ? el.getAttribute("tool-id") : null;
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
    () => new Map([...components(), ...tools()].map((plugin) => [plugin.id, plugin.name || plugin.id])),
  );
  const frames = createMemo(() => tagged(tools(), "frame-tool"));
  const current = () => props.account()?.frameToolId ?? runningFrame(props.element, frames());
  const titlebar = createMemo(() => tagged(tools(), "titlebar-tool"));

  const [threepane, threepaneHandle] = useDocument<ThreepaneConfigDoc>(() => props.account()?.tools?.threepane);
  const doctitle = () => threepane()?.doctitle?.tools?.map(slotId);

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
      <section class="settings-section" aria-labelledby="settings-frame">
        <h2 id="settings-frame">frame</h2>
        <Show when={frames().length} fallback={<p class="settings-hint">no frames are here yet</p>}>
          <div class="settings-choices" role="radiogroup" aria-label="frame">
            <For each={frames()}>
              {(frame) => (
                <button
                  type="button"
                  class="settings-choice"
                  role="radio"
                  aria-checked={current() === frame.id}
                  onClick={() => chooseFrame(frame.id)}
                >
                  {frame.name}
                </button>
              )}
            </For>
          </div>
          <p class="settings-hint">changing it reloads the page</p>
        </Show>
      </section>

      <Show when={threepaneHandle()}>
        {(handle) => (
          <section class="settings-section" aria-labelledby="settings-titlebar">
            <h2 id="settings-titlebar">title bar</h2>
            <p class="settings-hint">the tools along the top of a document. drag to reorder</p>
            <Strip
              values={doctitle() ?? []}
              options={titlebar()}
              names={names()}
              setValues={(next) =>
                handle().change((doc) => {
                  doc.doctitle ??= {};
                  doc.doctitle.tools = next.slice();
                })
              }
            />
          </section>
        )}
      </Show>
    </>
  );
}

// an ordered row of tool ids: drag to reorder, × to take one out, + to add.
// ids are kept as they are, even ones whose plugin hasn't registered yet
// (they're shown by id), so a slow plugin isn't dropped by a rewrite
function Strip(props: {
  values: string[];
  options: Option[];
  names: Map<string, string>;
  setValues: (next: string[]) => void;
}) {
  const [adding, setAdding] = createSignal(false);
  const [custom, setCustom] = createSignal("");
  const [from, setFrom] = createSignal<number | null>(null);
  const [to, setTo] = createSignal<number | null>(null);

  const nameOf = (id: string) => props.names.get(id) ?? id;
  const available = createMemo(() => props.options.filter((option) => !props.values.includes(option.id)));

  const add = (id: string) => {
    const clean = id.trim();
    if (clean && !props.values.includes(clean)) props.setValues([...props.values, clean]);
  };

  function drop() {
    const a = from();
    const b = to();
    setFrom(null);
    setTo(null);
    if (a == null || b == null || a === b) return;
    const next = props.values.slice();
    const [moved] = next.splice(a, 1);
    next.splice(b, 0, moved);
    props.setValues(next);
  }

  return (
    <div class="settings-strip">
      <ol class="settings-strip-items">
        <For each={props.values}>
          {(id, index) => (
            <li
              class="settings-strip-item"
              draggable={true}
              data-dragging={from() === index() ? "" : undefined}
              data-over={to() === index() && from() !== index() ? "" : undefined}
              onDragStart={(event) => {
                event.dataTransfer!.effectAllowed = "move";
                setFrom(index());
                setTo(index());
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer!.dropEffect = "move";
                setTo(index());
              }}
              onDragEnd={drop}
            >
              <span>{nameOf(id)}</span>
              <button
                type="button"
                class="settings-strip-remove"
                aria-label={`take out ${nameOf(id)}`}
                onClick={() => props.setValues(props.values.filter((_, i) => i !== index()))}
              >
                ×
              </button>
            </li>
          )}
        </For>
      </ol>
      <Show
        when={adding()}
        fallback={
          <button type="button" class="settings-button" onClick={() => setAdding(true)}>
            + add
          </button>
        }
      >
        <div class="settings-strip-add" onKeyDown={(event) => event.key === "Escape" && setAdding(false)}>
          <For each={available()} fallback={<span class="settings-hint">every title bar tool's in</span>}>
            {(option) => (
              <button type="button" class="settings-button" onClick={() => add(option.id)}>
                + {option.name}
              </button>
            )}
          </For>
          <form
            class="settings-cluster"
            onSubmit={(event) => {
              event.preventDefault();
              add(custom());
              setCustom("");
            }}
          >
            <input
              class="settings-input settings-code"
              placeholder="or a tool id"
              aria-label="a tool id"
              spellcheck={false}
              value={custom()}
              onInput={(event) => setCustom(event.currentTarget.value)}
            />
            <button type="submit" class="settings-button" disabled={!custom().trim()}>
              add
            </button>
            <button type="button" class="settings-button" onClick={() => setAdding(false)}>
              done
            </button>
          </form>
        </div>
      </Show>
    </div>
  );
}
