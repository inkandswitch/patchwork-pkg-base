import type { Plugin } from "esbuild";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// `virtual:ts-libs` resolves to a map of lib.*.d.ts filename -> source, read
// from the INSTALLED typescript package at build time. The TypeScript
// environment needs these to answer anything about a standard library type, and
// inlining them keeps the editor working offline. (file/ gets the same map from
// vite's `import.meta.glob`, which esbuild has no equivalent for.)
export default function tsLibs(): Plugin {
  return {
    name: "ts-libs",
    setup(build) {
      build.onResolve({ filter: /^virtual:ts-libs$/ }, (args) => ({
        path: args.path,
        namespace: "ts-libs",
      }));

      build.onLoad({ filter: /.*/, namespace: "ts-libs" }, () => {
        const require = createRequire(import.meta.url);
        const libDir = dirname(require.resolve("typescript"));
        const libs: Record<string, string> = {};
        for (const name of readdirSync(libDir)) {
          if (!name.startsWith("lib.") || !name.endsWith(".d.ts")) continue;
          libs["/" + name] = readFileSync(join(libDir, name), "utf8");
        }
        return {
          contents: `export default ${JSON.stringify(libs)}`,
          loader: "js",
        };
      });
    },
  };
}
