// The in-browser TypeScript environment behind completions, hovers and
// diagnostics for JS/TS documents. lib.*.d.ts are inlined from the INSTALLED
// typescript package at build time (see esbuild/plugin-ts-libs.ts), with a CDN
// fetch as fallback. Imported dynamically so the TypeScript compiler only ships
// -- as its own chunk -- when a code document is actually opened.
import ts from "typescript";
import {
  createDefaultMapFromCDN,
  createSystem,
  createVirtualTypeScriptEnvironment,
} from "@typescript/vfs";
import tsLibs from "virtual:ts-libs";

// A permissive ambient JSX namespace so .tsx/.jsx files don't report an error
// on every intrinsic element when no framework types are present.
const JSX_SHIM = `
declare namespace JSX {
	type Element = any
	interface ElementChildrenAttribute { children: {} }
	interface IntrinsicElements { [tag: string]: any }
}
`;

export const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  // programmatic `lib` wants full lib FILENAMES, not tsconfig-style names
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  allowJs: true,
  checkJs: false,
  strict: false,
  noEmit: true,
  allowNonTsExtensions: true,
};

export async function createTsEnv(path: string, initialCode: string) {
  const entries = Object.entries(tsLibs);
  // the inlined map came up empty (packaging quirk) -- fall back to the CDN
  // map, cached in localStorage by @typescript/vfs
  const fsMap =
    entries.length > 0
      ? new Map(entries)
      : await createDefaultMapFromCDN(
          { target: compilerOptions.target! },
          ts.version,
          true,
          ts
        );

  fsMap.set("/jsx-shim.d.ts", JSX_SHIM);
  fsMap.set(path, initialCode || " "); // the env refuses an empty root file

  const system = createSystem(fsMap);
  return createVirtualTypeScriptEnvironment(
    system,
    [path, "/jsx-shim.d.ts"],
    ts,
    compilerOptions
  );
}
