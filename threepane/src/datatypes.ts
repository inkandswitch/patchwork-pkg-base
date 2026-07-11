import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type {
  AccountDoc,
  ModuleSettingsDoc,
  ThreepaneConfigDoc,
} from "./types";

/**
 * The default system-tray tools for a fresh account. The tray is now an
 * explicit list on the threepane config doc (no longer registry-driven), so a
 * new account seeds this set; add/remove is a matter of editing the array.
 */
export const DEFAULT_TRAY_TOOLS: string[] = ["theme-tray"];

/**
 * Default scalar configuration for a fresh account. Subdoc URLs are intentionally
 * absent and are populated lazily by the frame on first mount.
 */
export const AccountDatatype: DatatypeImplementation<AccountDoc> = {
  init(doc) {
    doc.frameToolId = "threepane";
    // The left pane is now a widget list (migrated into the threepane config
    // doc); no default account sidebar tool. The context sidebar is
    // registry-driven now, so there's nothing to seed for it.
    // Title + spacer are rendered intrinsically by the frame's top bar; only the
    // right-hand doctitle tools are configured here.
    doc.documentToolbarToolIds = [
      "add-doc-to-sidebar-button",
      "doc-openwith",
      "doc-presence",
      "sync-indicator",
      "theme-titlebar",
    ];
  },
  getTitle: () => "Patchwork Account",
};

/**
 * The module-settings doc: the account's installed-packages list. The frame
 * seeds an empty one so `ensureAccountSubdocs` can point `moduleSettingsUrl` at
 * it; the `packages` tool renders/edits it. (Its datatype used to live in the
 * deleted `module-settings-manager` package — re-registered here so a fresh
 * account's subdoc bootstrap doesn't stall waiting on an unregistered datatype.)
 */
export const ModuleSettingsDatatype: DatatypeImplementation<ModuleSettingsDoc> =
  {
    init(doc) {
      doc["@patchwork"] = { type: "patchwork:module-settings" };
      doc.modules = [];
    },
    getTitle: (doc) => doc["@patchwork"]?.title ?? "Module Settings",
    setTitle(doc, title) {
      if (!doc["@patchwork"])
        doc["@patchwork"] = { type: "patchwork:module-settings" };
      doc["@patchwork"].title = title;
    },
  };

/** The threepane layout config doc (sidebar widgets, doctitle tools, tray). */
export const ThreepaneConfigDatatype: DatatypeImplementation<ThreepaneConfigDoc> =
  {
    init(doc) {
      doc.sidebar = { widgets: [] };
      doc.doctitle = { tools: [] };
      doc.tray = DEFAULT_TRAY_TOOLS.slice();
    },
    getTitle: () => "Threepane Config",
  };
