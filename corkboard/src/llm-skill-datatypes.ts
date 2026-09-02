// A generic "llm:skill" for Patchwork's chat computer: what document datatypes
// this Patchwork actually has installed. Nothing canvas-specific — it reads the
// `patchwork:datatype` registry, which is the same list the sideboard's
// create-new menu and the canvas's new-doc tool draw from.
//
// Deliberately NOT bound to a datatype, so it never auto-activates: it appears
// in the computer's skills index and is pulled in with load_skill (or by
// another skill, like this package's tldraw one, telling it to).

import { listDatatypes } from "./datatypes.js";

const INSTRUCTIONS = `
Find out which document datatypes this Patchwork has installed, and what their
ids are, instead of guessing.

Call list_datatypes. It reads the live \`patchwork:datatype\` plugin registry and
returns [{ id, name }, …]. The \`id\` is the canonical string everywhere else: a
document's \`@patchwork.type\`, a datatype argument to any tool that creates
documents, a \`docType\` on an embed.

- The list is per-session — it is whatever modules this Patchwork has loaded, and
  a different Patchwork will have a different set. Never assume an id that isn't
  in it, and re-read it rather than trusting one from earlier in a conversation.
- Datatypes marked unlisted (e.g. \`file\`) are omitted. They are produced by
  something else — an upload, an import — not created empty.
- An id here does NOT mean you know the document's shape. Once you have created
  or opened one, read_doc it and follow whichever skill activates for its type.
`.trim();

export const skill = {
  instructions: INSTRUCTIONS,
  tools: [
    {
      name: "list_datatypes",
      description:
        "List the document datatypes installed in this Patchwork as [{id, name}]. The id is what `@patchwork.type` and every datatype argument uses. Call this before creating a document or naming a type.",
      parameters: { type: "object", properties: {} },
    },
  ],
  runTool(name: string) {
    if (name !== "list_datatypes") return undefined;
    const datatypes = listDatatypes();
    if (datatypes.length === 0) {
      return "No datatypes are registered in this Patchwork (nothing has loaded a `patchwork:datatype` plugin).";
    }
    return { datatypes };
  },
};
