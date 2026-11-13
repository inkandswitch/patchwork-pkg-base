// the settings page. other packages get a section on it by registering a
// `patchwork:settings` plugin: static JSON, see ./schema.ts
const load = async () => (await import("./Settings")).default;

export const plugins = [
  {
    type: "patchwork:tool",
    id: "settings",
    name: "Settings",
    icon: "Settings",
    supportedDatatypes: ["account"],
    load,
  },
  // the old ids, from before the frame configurator and the account picker
  // were merged into this page. kept so anything that opens them by id still
  // lands here; unlisted so the page shows up once in menus.
  {
    type: "patchwork:tool",
    id: "frame-configurator",
    name: "Settings",
    icon: "Settings",
    supportedDatatypes: ["account"],
    unlisted: true,
    load,
  },
  {
    type: "patchwork:tool",
    id: "account-picker",
    name: "Settings",
    icon: "Settings",
    supportedDatatypes: ["account"],
    unlisted: true,
    load,
  },
];
