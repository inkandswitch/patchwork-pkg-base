// a theme's colour scheme, sniffed out of its stylesheet's
// `color-scheme: light|dark`, so the stylesheet is the one place it's said.
// undefined when it doesn't say. (theming's picker does the same.)
const sniffed = new Map<string, Promise<"light" | "dark" | undefined>>();

export function detectColorScheme(
  style: string | undefined
): Promise<"light" | "dark" | undefined> {
  if (!style) return Promise.resolve(undefined);
  let scheme = sniffed.get(style);
  if (!scheme) {
    scheme = fetch(style)
      .then((res) => res.text())
      .then(
        (css) =>
          css.match(/color-scheme:\s*(light|dark)/)?.[1] as
            "light" | "dark" | undefined
      )
      .catch(() => undefined);
    sniffed.set(style, scheme);
  }
  return scheme;
}
