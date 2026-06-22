import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  // The `as any` cast below resolves a vite/vitest peer-version type mismatch
  // (vitest 2.x bundles vite 5 types while we use vite 6). It does not affect
  // runtime behavior.
  plugins: [react() as never],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
