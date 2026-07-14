// Example document for fresh accounts (aggregated into the bundle's init.js):
// a markdown essay introducing the lab. Standalone: builds the doc shape
// inline instead of going through the plugin registry.

const CONTENT = `# Ink & Switch

An independent research lab exploring the future of tools for thought.

We envision a new computer that amplifies human intelligence. A system that
helps you think more clearly, collaborate more effectively, and is available
anywhere and anytime. Though the specifics of our work continue to evolve,
everything we do is in pursuit of this vision.

## Research Areas

Our research spans a wide variety of domains from theoretical computer
science to practical user experiences. We focus our research on four primary
themes.

### Local-first Software

Exploring software architecture that returns data to users and enables
collaboration in every tool.

### Malleable Software

Designing software environments where people can customize tools in the
moment to meet their unique needs.

### Programmable Ink

Discovering a dynamic medium for sketching ideas where adding behaviors and
interaction is as natural as applying ink to paper.

### Universal Version Control

Building tools to help people explore alternatives, keep track of history,
and collaborate better, across all kinds of media.
`;

export default async function example(repo) {
  const handle = await repo.create2({
    "@patchwork": {
      type: "essay",
      suggestedImportUrl: new URL("./dist/main.js", import.meta.url).href,
    },
    content: CONTENT,
  });

  return {
    name: "Ink & Switch",
    type: "essay",
    url: handle.url,
  };
}
