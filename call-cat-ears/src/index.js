// cat ears, for the call (the `call` package's video effects: its README says
// how an effect's made). this module only lists what's here, as plugins are
// read in a worker. effect.js is what draws, and the call's own worker imports
// it by its url, which is why it's a file of its own and has no imports
export const plugins = [
  {
    type: "patchwork:call-effect",
    id: "cat-ears",
    name: "Cat ears",
    icon: "Cat",
    kind: "overlay",
    needs: ["landmarks"],
    effect: "./effect.js",
    load: () => import("./effect.js"),
  },
];
