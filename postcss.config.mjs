/**
 * PostCSS configuration for Tailwind CSS v4.
 *
 * Tailwind v4 ships as a PostCSS plugin (`@tailwindcss/postcss`).
 * The theme is configured CSS-first via `@theme` in `src/app/globals.css`.
 *
 * Contract: docs/contracts/02_design_system_and_ux_contract.md
 * (Tailwind 4.x stable; CSS-first semantic theme tokens.)
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
