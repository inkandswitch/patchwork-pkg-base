# Patchwork

Read and follow [patchwork-skill.md](./patchwork-skill.md) before changing anything in this repository.

## Every folder is a separate tool

This repo is a collection, not a project. Each top-level directory with a
`package.json` is an independent package: its own dependencies, its own
`pnpm-lock.yaml`, its own `node_modules`, its own `pnpm-workspace.yaml` for
pnpm settings, its own build system. Some use esbuild, some use vite, some
have no build at all. Some are Solid, some are React, some are vanilla.

There is **no workspace and no lockfile at the repo root**. Nothing installs
there. `pnpm -r` has nothing to recurse over. To do something in every tool,
use `node scripts/each.mjs <script>` (`pnpm each install`, `pnpm test`).

You should be able to copy any one of these folders out of the repo, run
`pnpm install && pnpm build` inside it, and get the same result you get here.

### What that rules out

- No `workspace:`, `catalog:`, `link:` or `file:` dependency specifiers.
- No importing another tool's source, or reaching into its `dist/`.
- No assuming a sibling has been installed or built first — installs and
  builds run in arbitrary order and in parallel.
- No shared root config for tools to inherit.

`node scripts/lint-standalone.mjs` (`pnpm lint`) fails the build on any of
these, and on a `pnpm-workspace.yaml` at the root, and on a root
`pnpm-lock.yaml` that either resolves any package or is committed. (Running a
root script leaves an empty lockfile behind; it's gitignored and inert, so it's
tolerated on disk and nowhere else.) CI runs it on every PR.

### When two tools want the same code

Make them one package. A package can register as many plugins as it likes, so
several tools and datatypes can ship from one folder and share a module
directly — that's what `account/` is (the contact datatype and its views, plus
the account picker, sharing one colour palette). Copying the code is the other
acceptable answer. Linking them is not.

Tools may still depend on each other at *runtime* through the plugin registry —
by tool id, datatype id, or a `<patchwork-view tool-id="...">`. That's a
late-bound lookup that degrades to nothing if the other tool isn't installed,
which is fine. A build-time dependency is not.

## Testing

Every tool has a `test` script (`vitest run`) and a `vitest.config.ts`, set to
`passWithNoTests` so a tool without tests still reports green. `pnpm test` at
the root runs them all.
