#!/usr/bin/env node
// Standalone-package linter.
//
// Every top-level tool in this repo must be pullable on its own: you should be
// able to copy one folder out of the repo, run `pnpm install` + the build
// inside it, and get the same result. That breaks the moment a package.json
// leans on something only its neighbours provide. This script scans every
// per-tool package.json and fails if it finds such a dependency.
//
// Forbidden dependency specifiers (in dependencies / devDependencies /
// peerDependencies / optionalDependencies):
//   workspace:*  - pnpm workspace protocol; only resolvable inside a workspace
//   catalog:*    - pnpm catalog protocol; version lives outside the package
//   link:../x    - symlink to a sibling folder; gone once the folder is alone
//   file:../x    - tarball/dir reference that escapes the package folder
//
// It also fails if the repo root grows a pnpm-workspace.yaml, or a
// pnpm-lock.yaml that resolves anything, because either one would quietly
// re-link the tools back together. (Running a root script leaves behind an
// empty lockfile with no `packages:` section; that one is inert and ignored.)
//
// Run from the repo root: `node scripts/lint-standalone.mjs` (or `pnpm lint`).

import fs from "node:fs"
import path from "node:path"
import {fileURLToPath} from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]

// specifier -> human-readable reason
const FORBIDDEN = [
  [/^workspace:/, "uses the pnpm `workspace:` protocol"],
  [/^catalog:/, "uses the pnpm `catalog:` protocol (version defined outside the package)"],
  [/^link:/, "uses `link:` to a sibling folder"],
  [/^file:/, "uses `file:` to a path outside the package"],
]

// files that would turn the repo back into one big install
const ROOT_FILES = [
  ["pnpm-workspace.yaml", "would make every tool a workspace project again", () => true],
  [
    "pnpm-lock.yaml",
    "resolves dependencies at the root, where nothing should install",
    (contents) => /^packages:/m.test(contents),
  ],
]

function packageDirs() {
  return fs
    .readdirSync(root)
    .filter((name) => {
      if (name === "node_modules" || name.startsWith(".")) return false
      const dir = path.join(root, name)
      return (
        fs.statSync(dir).isDirectory() &&
        fs.existsSync(path.join(dir, "package.json"))
      )
    })
    .sort()
}

const violations = []

for (const [file, reason, offending] of ROOT_FILES) {
  const at = path.join(root, file)
  if (fs.existsSync(at) && offending(fs.readFileSync(at, "utf8"))) {
    violations.push({pkg: ".", field: "root", dep: file, spec: "", reason})
  }
}

for (const name of packageDirs()) {
  const pjPath = path.join(root, name, "package.json")
  let pj
  try {
    pj = JSON.parse(fs.readFileSync(pjPath, "utf8"))
  } catch (err) {
    violations.push({pkg: name, dep: "package.json", spec: "", reason: `is not valid JSON: ${err.message}`})
    continue
  }

  for (const field of DEP_FIELDS) {
    const deps = pj[field]
    if (!deps || typeof deps !== "object") continue
    for (const [dep, spec] of Object.entries(deps)) {
      if (typeof spec !== "string") continue
      for (const [re, reason] of FORBIDDEN) {
        if (re.test(spec)) {
          violations.push({pkg: name, field, dep, spec, reason})
        }
      }
    }
  }
}

if (violations.length === 0) {
  console.log("✓ every package installs on its own")
  process.exit(0)
}

console.error(`✗ found ${violations.length} thing(s) tying the packages together:\n`)
for (const v of violations) {
  console.error(`  ${v.pkg === "." ? v.dep : `${v.pkg}/package.json → ${v.field}.${v.dep}`}`)
  console.error(`    ${v.spec ? `"${v.spec}"  ` : ""}${v.reason}`)
  console.error(
    v.pkg === "."
      ? `    fix: delete it.\n`
      : `    fix: replace with a registry version range, or move the shared code into this package.\n`
  )
}
process.exit(1)
