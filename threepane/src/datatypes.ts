import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { AccountDoc, ThreepaneConfigDoc } from "./types";

/**
 * The default system-tray tools for a fresh account. The tray is now an
 * explicit list on the threepane config doc (no longer registry-driven), so a
 * new account seeds this set; add/remove is a matter of editing the array.
 */
export const DEFAULT_TRAY_TOOLS: string[] = ["theme-tray"];

/**
 * The default doctitle tools for a fresh (or empty) account. Title + spacer are
 * intrinsic to the frame's top bar, so only the right-hand tools are listed.
 */
export const DEFAULT_DOCTITLE_TOOLS: string[] = [
  "add-doc-to-sidebar-button",
  "doc-openwith",
  "doc-presence",
  "sync-indicator",
  "theme-titlebar",
];

/** Default scalar configuration for a fresh account. */
export const AccountDatatype: DatatypeImplementation<AccountDoc> = {
  init(doc) {
    doc.frameToolId = "threepane";
    // The left pane is now a widget list (migrated into the threepane config
    // doc); no default account sidebar tool. The context sidebar is
    // registry-driven now, so there's nothing to seed for it.
    // Title + spacer are rendered intrinsically by the frame's top bar; only the
    // right-hand doctitle tools are configured here.
    doc.documentToolbarToolIds = DEFAULT_DOCTITLE_TOOLS.slice();
  },
  getTitle: () => "Patchwork Account",
};

/** The threepane layout config doc (sidebar widgets, doctitle tools, tray). */
export const ThreepaneConfigDatatype: DatatypeImplementation<ThreepaneConfigDoc> =
  {
    init(doc) {
      doc.sidebar = { widgets: [] };
      doc.doctitle = { tools: DEFAULT_DOCTITLE_TOOLS.slice() };
      doc.tray = DEFAULT_TRAY_TOOLS.slice();
    },
    getTitle: () => "Threepane Config",
  };
