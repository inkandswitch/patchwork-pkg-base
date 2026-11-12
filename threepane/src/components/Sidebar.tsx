import {
  Show,
  createEffect,
  createSignal,
  on,
  onCleanup,
  type Accessor,
  type JSX,
} from "solid-js";
import type { SidebarSide } from "../hooks";

type SidebarProps = {
  side: SidebarSide;
  isCollapsed: Accessor<boolean>;
  width: Accessor<number>;
  onMouseDown: (e: MouseEvent) => void;
  onToggleClick: (e: MouseEvent) => void;
  canExpand?: Accessor<boolean>;
  children?: JSX.Element;
};

/** How long the element's `width` transition runs, in ms (0 if it has none,
 * as during a live drag, or where there is no layout at all). */
function widthTransitionMs(el: HTMLElement): number {
  const seconds = parseFloat(getComputedStyle(el).transitionDuration);
  return Number.isFinite(seconds) ? seconds * 1000 : 0;
}

/**
 * Sidebar shell for the left and right sidebars: owns the collapse/resize chrome
 * and renders `children` while open. The content stays mounted while the width
 * animates shut, so it is squeezed away with the panel (the nextaction feel)
 * rather than vanishing ahead of it; once closed it is unmounted, and rebuilt on
 * re-expand, so anything holding a ref into it must rebind on the element.
 * Props are accessed via `props.x` (not destructured) to preserve Solid reactivity.
 */
export function Sidebar(props: SidebarProps) {
  // Collapsed sidebars shrink to zero width. The resize/toggle button still
  // renders and straddles the edge (it reserves no layout column), so it stays
  // grabbable as a drag-to-reopen handle even at 0px.
  const widthStyle = () => `${props.isCollapsed() ? 0 : props.width()}px`;
  const canExpand = () => props.canExpand?.() ?? true;

  let root: HTMLDivElement | undefined;
  // `present` is whether the content is mounted: it lags a collapse by the
  // width transition. `moving` is true while that transition runs, either way,
  // and clips the content to the panel (see `.sidebar[data-moving]`).
  const [present, setPresent] = createSignal(!props.isCollapsed());
  const [moving, setMoving] = createSignal(false);
  let settle: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(
      props.isCollapsed,
      (collapsed) => {
        clearTimeout(settle);
        if (!collapsed) setPresent(true);
        // No transition (mid-drag, motion off) means nothing to wait for.
        const ms = root ? widthTransitionMs(root) : 0;
        if (ms < 5) {
          setMoving(false);
          if (collapsed) setPresent(false);
          return;
        }
        setMoving(true);
        settle = setTimeout(() => {
          setMoving(false);
          if (collapsed) setPresent(false);
        }, ms);
      },
      { defer: true }
    )
  );
  onCleanup(() => clearTimeout(settle));

  const content = () => <Show when={present()}>{props.children}</Show>;

  const handle = () => (
    <Show when={!props.isCollapsed() || canExpand()}>
      <button
        onClick={(e) => props.onToggleClick(e)}
        onMouseDown={(e) => props.onMouseDown(e)}
        class="sidebar-toggle sidebar-toggle--resizable"
        aria-label={
          props.isCollapsed() ? "Expand sidebar" : "Toggle or resize sidebar"
        }
        title={
          props.isCollapsed()
            ? "Click to expand, drag to resize"
            : "Click to toggle, drag to resize"
        }
      />
    </Show>
  );

  // The handle sits on the sidebar's inner edge: after the content on the left,
  // before it on the right.
  return (
    <div
      ref={root}
      class="sidebar"
      data-side={props.side}
      data-moving={moving() ? "" : undefined}
      data-collapsed={props.isCollapsed() ? "" : undefined}
      style={{ width: widthStyle() }}
    >
      {props.side === "left" ? (
        <>
          {content()}
          {handle()}
        </>
      ) : (
        <>
          {handle()}
          {content()}
        </>
      )}
    </div>
  );
}
