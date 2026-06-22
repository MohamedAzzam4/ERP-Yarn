# Coding-Agent Prompt — Static UI/UX Prototype

Use this with OpenCode, Antigravity, or another coding agent only after the Stitch full-screen set and design system are approved.

---

Build a static Arabic-first UI/UX prototype for the ERP Yarn project from the approved design artifacts.

## Authority and boundaries

Read:

- `/ui-ux-lab/00_standalone_ui_ux_plan.md`
- the approved design-system decision sheet;
- the final Stitch manifest;
- all approved Stitch screenshots/exports.

This is an independent visual prototype, not the ERP implementation. Do not modify `/docs/contracts`, `/docs/execution`, the real application, database files, migrations, or backend work packages.

Put all code in a separately named prototype directory and work on a dedicated UI-lab branch.

Do not add:

- server-side code;
- API routes;
- database or cloud SDKs;
- authentication;
- business calculations or posting logic;
- real mutations;
- Supabase, Firebase, or secrets;
- real client data.

## Fidelity requirement

Implement every screen in the approved 46-screen Stitch manifest during one bounded implementation run. Use shared primitives, but do not redesign screens while coding.

Each screen has an immutable acceptance screenshot. Implement it, compare it, and mark it complete. Later screens must not change completed screen-specific markup or styling. Shared-token changes that would alter completed screens are forbidden without explicit owner approval.

If a correction is required, preserve the original implementation route and create a versioned review route or obtain owner approval before replacement.

## Allowed behavior

Allowed:

- navigation between screens;
- role-based presentation presets for design review;
- static tabs, accordions, drawers, dialogs, and menus;
- responsive layout demonstrations;
- toggling between predefined visual states;
- reset to static fixture state.

Forbidden:

- operational create/update/delete behavior;
- fake backend success claims;
- accounting, inventory, production, approval, migration, backup, or permission logic;
- persistence presented as authoritative;
- uncontrolled reinterpretation of Stitch output.

All operational buttons must be disabled or visibly labeled `عنصر عرض غير تشغيلي`. Display `نموذج واجهة فقط — بيانات تجريبية غير حقيقية` in every shell.

## Technical expectations

- Use a client-only web stack suitable for static hosting.
- Use current compatible stable versions verified through Context7.
- Use semantic reusable components and design tokens.
- Set the root to Arabic RTL.
- Isolate mixed-direction values locally.
- Use one consistent SVG icon set and no emoji icons.
- Support worker screens from 360 px upward and management screens at tablet/desktop widths.
- Provide visible focus, reduced-motion support, sufficient contrast, labels, and keyboard navigation.
- Use fixture modules only; no environment variables.

## Verification

Run formatting, lint, typecheck, component tests, production build, route smoke checks, accessibility smoke checks, RTL/LTR checks, responsive screenshots, and a secret scan.

Visual review must compare:

- the three approved reference screens first;
- every implemented route against its immutable acceptance screenshot;
- worker financial redaction;
- typography, colors, spacing, density, borders, radii, shadows, icons, and responsive behavior.

## Completion report

Provide:

1. branch and commit;
2. complete 46-screen route manifest;
3. tests and build results;
4. screenshot comparison evidence;
5. responsive checks;
6. known visual mismatches;
7. confirmation that no backend/cloud/secret was added;
8. confirmation that completed earlier screens were not changed while implementing later screens.

Do not call this the completed ERP MVP. Call it **ERP Yarn Static UI/UX Prototype**.

---

