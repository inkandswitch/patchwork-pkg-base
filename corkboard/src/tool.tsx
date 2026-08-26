import "./styles.css";
// Pulls in <patchwork-view> JSX intrinsic type augmentations.
import type {} from "@inkandswitch/patchwork-elements";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import type { ToolImplementation } from "@inkandswitch/patchwork-plugins";
import {
  createEffect,
  createSignal,
  onCleanup,
  Show,
  type Accessor,
} from "solid-js";
import { render } from "solid-js/web";

// The corkboard: a tldraw canvas wrapped in the provenance provider. The
// canvas itself is rendered by the tldraw5 tool via `<patchwork-view>`; the
// value added here is the context — every doc pinned to the canvas mounts
// inside the provider's subtree, so the provider can index their
// `@patchwork.provenance` sections and answer `patchwork:provenance`
// subscriptions from any of them (see `ProvenanceProvider`).
const mount: ToolImplementation = (handle, element) =>
  render(() => <Corkboard docUrl={handle.url} />, element);

export default mount;

function Corkboard(props: { docUrl: AutomergeUrl }) {
  const [providerElement, setProviderElement] = createSignal<HTMLElement>();
  const isProviderReady = useProviderReady(
    "patchwork-provenance-provider",
    providerElement
  );

  return (
    <div class="corkboard">
      <patchwork-view
        component="patchwork-provenance-provider"
        ref={setProviderElement}
      >
        <Show when={isProviderReady()}>
          <patchwork-view doc-url={props.docUrl} tool-id="tldraw5" />
        </Show>
      </patchwork-view>
    </div>
  );
}

// Gate the canvas on the provider having attached its listeners, so
// `patchwork:subscribe` events from the canvas (and the docs pinned to it)
// can't fire into the void. Same pattern as the threepane frame.
function useProviderReady(
  componentId: string,
  element: Accessor<HTMLElement | undefined>
): Accessor<boolean> {
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
}
