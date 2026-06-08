import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { ModuleSettingsDoc } from "@inkandswitch/patchwork-filesystem";

export const ModuleSettingsDatatype: DatatypeImplementation<ModuleSettingsDoc> =
  {
    init(doc) {
      doc.modules = [];
    },
    getTitle: (doc) => (doc["@patchwork"] as any)?.title ?? "Module Settings",
    setTitle(doc, title) {
      if (!doc["@patchwork"])
        doc["@patchwork"] = { type: "patchwork:module-settings" };
      (doc["@patchwork"] as any).title = title;
    },
  };
