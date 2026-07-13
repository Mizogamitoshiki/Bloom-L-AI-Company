import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@core": path.resolve(__dirname, "src/core"),
      "@adapters": path.resolve(__dirname, "src/adapters"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
