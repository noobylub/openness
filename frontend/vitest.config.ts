import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "#lib": fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
  test: { include: ["src/**/*.test.ts"] },
});
