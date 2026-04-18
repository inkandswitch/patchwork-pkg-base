import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { ModuleSettingsDoc } from "@inkandswitch/patchwork-filesystem";

export const ModuleSettingsDatatype: DatatypeImplementation<ModuleSettingsDoc> =
  {
    init(doc) {
      doc.modules = [];
    },
    getTitle: () => "Module Settings",
  };
