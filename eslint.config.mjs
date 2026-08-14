/**
 * Flat ESLint configuration for ERP-Yarn.
 *
 * - Uses eslint-config-next (Next.js 16.2.9 core-web-vitals + TypeScript rules).
 * - No custom business-rule linting yet; WP-00-02 is stack-only.
 *
 * Contract: docs/contracts/13_work_packages.md WP-00-02 (clean install/build/
 * typecheck/lint). No domain-specific lint rules until their contracts land.
 *
 * eslint-config-next 16.2.9 ships a CommonJS `module.exports = Linter.Config[]`
 * array. We interop-import it and spread into the flat config array.
 */
import nextConfig from "eslint-config-next";

const next = Array.isArray(nextConfig) ? nextConfig : [nextConfig];

const config = [
  ...next,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "coverage/**",
      "docs/**",
      "ui-ux-lab/**",
      "drizzle/output/**",
    ],
  },
  {
    // Rules that don't require a specific plugin — safe to define globally.
    rules: {},
  },
];

export default config;
