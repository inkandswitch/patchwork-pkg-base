// a colour for someone who's not picked one, from who they are: patchwork's
// presence colours (the account package's palette), as lattice's pointers have
export const COLOURS = [
  ["sky", "hsl(200, 70%, 50%)"],
  ["coral", "hsl(10, 75%, 58%)"],
  ["emerald", "hsl(145, 70%, 45%)"],
  ["violet", "hsl(270, 70%, 55%)"],
  ["amber", "hsl(38, 85%, 50%)"],
  ["rose", "hsl(350, 70%, 55%)"],
  ["teal", "hsl(178, 70%, 45%)"],
  ["indigo", "hsl(235, 70%, 58%)"],
  ["lime", "hsl(85, 70%, 45%)"],
  ["fuchsia", "hsl(310, 70%, 55%)"],
  ["orange", "hsl(25, 80%, 52%)"],
  ["cyan", "hsl(188, 75%, 48%)"],
];
// the colour of someone who's not picked one: one of those, from their url
export const colourFor = (url) =>
  COLOURS[[...String(url)].reduce((sum, char) => sum + char.charCodeAt(0), 0) % COLOURS.length][1];

