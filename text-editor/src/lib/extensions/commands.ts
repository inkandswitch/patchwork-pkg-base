// The `/` menu.
//
// Typing `/` at the start of a line opens a command list. It's a CodeMirror
// completion source rather than a bespoke popover, so filtering, keyboard
// navigation and styling come from the editor and the menu behaves like every
// other completion -- Escape dismisses it, typing something that matches
// nothing dismisses it, and it never eats a `/` you meant to type.
//
// Extensions contribute commands by registering `text-editor:command` plugins.
// Like every plugin the entry is cloned to a worker, so it carries metadata
// only and the behaviour lives behind `load()`:
//
//   { type: "text-editor:command", id: "wrap", name: "/wrap",
//     description: "Hard-wrap the selection",
//     async load() { return {run: (context) => …} } }

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Prop as AutomergeProp } from "@automerge/automerge/slim";
import type { DocHandle } from "@automerge/automerge-repo/slim";
import { getRegistry } from "@inkandswitch/patchwork-plugins";

import { togglePluginPanel } from "./pluginPanel.ts";

export const COMMAND = "text-editor:command";

/** What a command is handed when it runs. */
export type CommandContext = {
  view: EditorView;
  handle: DocHandle<unknown>;
  path: AutomergeProp[];
};

export type CommandDescription = {
  id: string;
  name: string;
  description?: string;
};

const BUILT_INS: (CommandDescription & {
  run: (context: CommandContext) => void;
})[] = [
  {
    id: "plugins",
    name: "/plugins",
    description: "Turn editor plugins on and off for this document",
    run: ({ view }) => view.dispatch({ effects: togglePluginPanel.of(true) }),
  },
];

function registered(): CommandDescription[] {
  try {
    return getRegistry<any>(COMMAND).filter(() => true);
  } catch {
    return [];
  }
}

async function run(id: string, context: CommandContext) {
  const builtIn = BUILT_INS.find((command) => command.id === id);
  if (builtIn) return builtIn.run(context);
  try {
    const loaded = await getRegistry<any>(COMMAND).load(id);
    loaded?.module?.run?.(context);
  } catch (error) {
    console.warn(`[text-editor] command ${id}:`, error);
  }
}

export function commands(
  handle: DocHandle<unknown>,
  path: AutomergeProp[],
  // False when the host chose this document's plugins itself (a file with no
  // array of its own gets an editor derived from its name), so
  // `doc["@text-editor"].plugins` isn't what's being read and offering to edit
  // it would be a lie.
  options: { pluginsEditable: boolean } = { pluginsEditable: true }
): Extension {
  const builtIns = options.pluginsEditable
    ? BUILT_INS
    : BUILT_INS.filter((c) => c.id !== "plugins");

  const source = (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/^\/\w*/);
    if (!match || (match.from === match.to && !context.explicit)) return null;

    const seen = new Set<string>();
    const options: Completion[] = [];
    for (const command of [...registered(), ...builtIns]) {
      if (!command?.id || seen.has(command.id)) continue;
      seen.add(command.id);
      options.push({
        label: command.name ?? `/${command.id}`,
        detail: command.description,
        type: "keyword",
        apply: (view: EditorView, _completion, from: number, to: number) => {
          // Take the `/whatever` back out -- a command is an instruction, not
          // text the document should keep.
          view.dispatch({ changes: { from, to, insert: "" } });
          void run(command.id, { view, handle, path });
        },
      });
    }

    return { from: match.from, options };
  };

  return [
    autocompletion(),
    // Registered through languageData rather than `override` so it composes:
    // `override` would replace every other completion source in the editor,
    // and a document with the TypeScript plugin on has one of its own.
    EditorState.languageData.of(() => [{ autocomplete: source }]),
  ];
}
