/** CodeMirror Extensions */
import { completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { foldKeymap, indentOnInput, indentUnit } from "@codemirror/language";
import { styleTags, tags } from "@lezer/highlight";
import { languages } from "@codemirror/language-data";
import { searchKeymap } from "@codemirror/search";
import { EditorView, keymap } from "@codemirror/view";

import { markdownFormattingKeymap } from "./formatting.ts";
import { taskCheckboxes } from "./tasks.ts";
import { margin } from "./margin.ts";
import { headings } from "./headings.ts";
import { markdownZoom } from "./zoom.ts";

/** Styles */
import { theme } from "../themes/markdown.ts";

// Undo/redo (`history()`/`historyKeymap`) is deliberately absent: the base
// editor (codemirror-base) owns it, so it can reset the stack when a scope
// swap re-points the doc handle (see codemirror-base's history extension).
// Adding a second `history()` here would keep the underlying singleton state
// field alive across that reset and break it.
export function markdownExtensions() {
  return [
    ...theme("sans"),
    indentOnInput(),
    markdownZoom,
    keymap.of([
      ...markdownFormattingKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    EditorView.lineWrapping,
    // GFM base: task lists, tables, strikethrough, autolinks.
    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      extensions: [bareUrls],
    }),
    taskCheckboxes,
    margin,
    headings,
    indentUnit.of("    "),
  ];
}

/**
 * A url pasted on its own is a link, not code. Only the url *inside* link
 * syntax — `[text](url)`, `<url>`, `[ref]: url`, `![alt](url)` — is markup,
 * so only that keeps `tags.url` (and the code font the theme gives it).
 * Path rules outrank the plain `URL` rule lezer-markdown ships with.
 */
export const bareUrls = {
  props: [
    styleTags({
      URL: tags.link,
      "Link/URL Image/URL Autolink/URL LinkReference/URL": tags.url,
    }),
  ],
};
