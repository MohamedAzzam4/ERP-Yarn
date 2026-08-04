/**
 * Vitest configuration for ERP-Yarn.
 *
 * WP-00-02 scope: environment/validation tests only. Domain service tests,
 * database tests, and browser tests arrive in their contracted packages.
 *
 * Contract: docs/contracts/12_testing_and_regression_plan.md
 * (focused tests continuously during implementation; package gate after
 * every WP; integrated phase gate before merge — DEC-058.)
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      // Tests run outside Next.js request routing; stub `server-only` so its
      // import-time throw does not break unit tests. The real package still
      // enforces the boundary in `next build`.
      "server-only": path.resolve(
        root,
        "src/lib/__mocks__/server-only.ts",
      ),
    },
  },
  test: {
    testTimeout: 60000,
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**", "coverage/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**", "src/server/**"],
      exclude: ["src/**/*.test.*", "src/**/__mocks__/**"],
    },
  },
});
