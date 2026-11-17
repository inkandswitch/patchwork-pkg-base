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


// someone's colour as it's drawn: a palette colour is its theme token
// (--studio-presence-sky-blue, theming's theme.css), falling back to what was
// stored, so the call's in the same colour as their cursor when a theme
// restyles them. any other colour is as it is. (the account package's
// themedColor, copied)
const squash = (colour) => String(colour).replace(/\s+/g, "").toLowerCase();
const TOKENS = new Map(COLOURS.map(([name, value]) => [squash(value), `--studio-presence-${name === "sky" ? "sky-blue" : name}`]));
export const themed = (colour) => {
  const token = TOKENS.get(squash(colour));
  return token ? `var(${token}, ${colour})` : colour;
};
