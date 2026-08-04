export const plugins = [
  {
    type: "patchwork:datatype",
    id: "text",
    name: "Text",
    icon: "Type",
    async load() {
      const { TextDatatype } = await import("./datatype.ts");
      return TextDatatype;
    },
  },
  {
    // Which extensions are active is driven by the document's
    // `@text-editor.plugins` array, not by its datatype -- `supportedDatatypes`
    // only says which documents this tool will open at all.
    type: "patchwork:tool",
    id: "codemirror",
    name: "Text Editor",
    supportedDatatypes: ["text", "essay", "markdown"],
    async load() {
      const { mount } = await import("./tool.tsx");
      return mount;
    },
  },
  {
    // Embeddable bare editor: <patchwork-view component="text-editor" doc-url=…>
    type: "patchwork:component",
    id: "text-editor",
    name: "Text Editor",
    icon: "Type",
    async load() {
      const { TextEditorComponent } = await import("./component.tsx");
      return TextEditorComponent;
    },
  },
];
