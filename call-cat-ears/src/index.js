// cat ears, for the call (the `call` package's video effects: its README says
// how an effect's made). this module only lists what's here, as plugins are
// read in a worker. effect.js is what draws, and the call's own worker imports
// it by its url, which is why it's a file of its own and has no imports
// the module that draws, by its whole url: next to this one (dist/, once
// built). not from the registry's importUrl, which can be the package's
// folder rather than this file. (a name, not a string in new URL(), or vite
// would copy effect.js's source in as an asset, unbundled)
const EFFECT = "./effect.js";

export const plugins = [
  {
    type: "patchwork:call-effect",
    id: "cat-ears",
    name: "Cat ears",
    icon: "Cat",
    kind: "overlay",
    needs: ["landmarks"],
    effect: new URL(EFFECT, import.meta.url).href,
    load: () => import("./effect.js"),
  },
];
