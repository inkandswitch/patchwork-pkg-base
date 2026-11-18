// the call's line drawings, on a 16 unit square, in the ink they sit in
// (lattice's, wm/ui/icons.js: just the ones a call uses)
const SVG = "http://www.w3.org/2000/svg";

const PATHS = {
  close: "M4.5 4.5l7 7M11.5 4.5l-7 7",
  minimise: "M11.5 4.5l-7 7M4.5 6.5v5h5",
  // a box's corners, out to fill it, and in from it
  fill: "M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10",
  unfill: "M6 2.5V6H2.5M10 2.5V6h3.5M13.5 10H10v3.5M6 13.5V10H2.5",
  screen: "M2.5 3.5h11v7.5h-11zM5.5 13.5h5M8 11v2.5",
  // six teeth round a hole
  cog: "M6.73 3.27 6.83 1.5A6.6 6.6 0 0 1 9.17 1.5l.1 1.77a4.9 4.9 0 0 1 2.19 1.27l1.58-.8a6.6 6.6 0 0 1 1.17 2.02l-1.48.97a4.9 4.9 0 0 1 0 2.54l1.48.97a6.6 6.6 0 0 1-1.17 2.02l-1.58-.8a4.9 4.9 0 0 1-2.19 1.27l-.1 1.77a6.6 6.6 0 0 1-2.34 0l-.1-1.77a4.9 4.9 0 0 1-2.19-1.27l-1.58.8a6.6 6.6 0 0 1-1.17-2.02l1.48-.97a4.9 4.9 0 0 1 0-2.54L1.79 5.76a6.6 6.6 0 0 1 1.17-2.02l1.58.8a4.9 4.9 0 0 1 2.19-1.27ZM10.1 8a2.1 2.1 0 1 1-4.2 0 2.1 2.1 0 1 1 4.2 0Z",
  phone: "M3.5 2.5H6l1 3-1.5 1a7 7 0 0 0 4 4l1-1.5 3 1V12.5a1 1 0 0 1-1 1A10.5 10.5 0 0 1 2.5 3.5a1 1 0 0 1 1-1Z",
  "hang-up": "M1.8 9.6c3.5-3.3 8.9-3.3 12.4 0l-.9 2-2.6-.5-.4-1.9a6.5 6.5 0 0 0-4.6 0l-.4 1.9-2.6.5Z",
  mic: "M8 2a2 2 0 0 1 2 2v4a2 2 0 0 1-4 0V4a2 2 0 0 1 2-2ZM4.5 7.5a3.5 3.5 0 0 0 7 0M8 11v2.5",
  "mic-off": "M8 2a2 2 0 0 1 2 2v4a2 2 0 0 1-4 0V4a2 2 0 0 1 2-2ZM4.5 7.5a3.5 3.5 0 0 0 7 0M8 11v2.5M2.5 2.5l11 11",
  video: "M2 4.5h8v7H2ZM10 7l4-2.5v7L10 9",
  "video-off": "M2 4.5h8v7H2ZM10 7l4-2.5v7L10 9M1.5 2.5l12 11",
};

/**
 * a line icon, as an <svg> element: goes into html`` templates and plain dom
 * alike. `size` is anything an svg's width takes, or a number of px; by default it's as big as the text
 * around it, and sits on its line like a letter
 */
export function icon(name, size = "1em") {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  if (typeof size === "number") {
    svg.style.width = svg.style.height = `${size}px`;
  }
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `icon icon-${name}`);
  svg.style.flex = "none";
  svg.style.verticalAlign = "-0.125em";
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", PATHS[name]);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.4");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}
