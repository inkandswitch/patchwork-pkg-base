// the settings page. other packages get a section on it by registering a
// `patchwork:settings` plugin: static JSON, see ./schema.ts
export const plugins = [
  {
    type: "patchwork:tool",
    id: "settings",
    name: "Settings",
    icon: "Settings",
    supportedDatatypes: ["account"],
    async load() {
      return (await import("./Settings")).default;
    },
  },
];
