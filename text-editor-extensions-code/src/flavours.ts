// The four ways `@codemirror/lang-javascript` can parse a document, and the
// virtual file path each one gets in the TypeScript environment. TypeScript
// decides how to parse from the path's final extension, so .mts/.cts collapse
// to .ts and .mjs/.cjs to .js.

export type Flavour = {
  path: string;
  jsx: boolean;
  typescript: boolean;
};

export const JS: Flavour = { path: "/index.js", jsx: false, typescript: false };
export const JSX: Flavour = { path: "/index.jsx", jsx: true, typescript: false };
export const TS: Flavour = { path: "/index.ts", jsx: false, typescript: true };
export const TSX: Flavour = { path: "/index.tsx", jsx: true, typescript: true };

export const FLAVOURS: Record<string, Flavour> = {
  js: JS,
  mjs: JS,
  cjs: JS,
  jsx: JSX,
  ts: TS,
  mts: TS,
  cts: TS,
  tsx: TSX,
};
