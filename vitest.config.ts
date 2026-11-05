import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@netrabox/core/schemas": path.resolve(__dirname, "packages/core/src/schemas/index.ts"),
      "@netrabox/core/db": path.resolve(__dirname, "packages/core/src/db/client.ts"),
      "@netrabox/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@netrabox/sdk": path.resolve(__dirname, "packages/sdk/src/index.ts"),
      "@netrabox/bench": path.resolve(__dirname, "packages/bench/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
  },
});
