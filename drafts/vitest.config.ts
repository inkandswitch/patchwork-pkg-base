import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: "happy-dom",
    globals: true,
    passWithNoTests: true,
    // The host shares one automerge between the repo and the tools; without
    // this the repo's docs come from a second copy the tool's can't read.
    server: { deps: { inline: ["@automerge/automerge-repo"] } },
  },
  resolve: {
    conditions: ["development", "browser"],
    dedupe: ["@automerge/automerge"],
  },
});
