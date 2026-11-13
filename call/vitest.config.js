import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    passWithNoTests: true,
    // solid and its store resolved by vite alike (browser, dev), not one by node
    server: { deps: { inline: [/solid-js/] } },
  },
  resolve: {
    conditions: ["development", "browser"],
  },
});
