import { defineConfig } from "vite";

// two entries, and no chunk between them. index.js is the plugin list, read in
// a worker as everything is. effect.js is imported by the call's own worker,
// where there's no import map, so it has to carry everything it uses
export default defineConfig({
  base: "./",
  build: {
    sourcemap: true,
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: { index: "./src/index.js", effect: "./src/effect.js" },
      output: { format: "es", entryFileNames: "[name].js", chunkFileNames: "assets/[name]-[hash].js" },
      preserveEntrySignatures: "strict",
    },
  },
});
