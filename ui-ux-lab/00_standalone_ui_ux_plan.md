# Standalone UI/UX Exploration Plan

## 1. Status and separation

This is an independent design-laboratory plan. It is **not** part of the ERP implementation plan, its work packages, or its phase-completion evidence.

Nothing produced here is authoritative for database design, business rules, permissions, security, accounting, inventory posting, production posting, migration, backup, or deployment. A visual prototype cannot prove that the ERP works.

The purpose is to decide what the product should look and feel like before real frontend screens become coupled to backend behavior.

## 2. Why this track exists

Backend and business behavior must eventually be correct and testable. Visual design is different: the owner and client can meaningfully compare navigation, hierarchy, density, typography, colors, forms, tables, dashboards, and task simplicity before any operational logic exists.

Changing the visual system after backend-connected screens are implemented causes avoidable rework and regression risk. This track therefore freezes the visual language first, while changes remain cheap.

## 3. Scope

This track produces:

- multiple visual directions using identical screen content;
- an owner-approved visual direction;
- an approved Arabic-first design system;
- a complete high-fidelity screen set;
- an optional static coded prototype using synthetic data;
- screenshots, screen names, tokens, component patterns, and review decisions for later frontend implementation.

The static prototype may support navigation, opening visual drawers/modals, tab switching, and responsive layouts. It must not implement operational mutations or business calculations.

## 4. Non-goals

Do not implement or simulate:

- server-side code;
- API routes;
- database access or migrations;
- Supabase, Firebase, or other cloud data services;
- authentication or authorization claims;
- inventory, WIP, reservation, approval, costing, subledger, profitability, migration, backup, or audit logic;
- real posting actions;
- real client data;
- exports presented as backups;
- tests that claim business correctness.

Controls may appear for layout evaluation, but operational controls must be labeled as static/non-operational in the coded prototype.

## 5. Invariants across every visual direction

The following do not change while experimenting with style:

- Arabic-first RTL interface;
- Western numerals;
- `DD/MM/YYYY` display dates;
- local LTR isolation for codes, dates, quantities, money, emails, phones, and technical identifiers;
- worker, accountant, and owner experiences remain visibly different;
- workers never see prices, balances, direct costs, accounting terms, or profitability;
- worker screens are task-first, one-column at narrow widths, and use 44×44 px minimum targets;
- management screens are desktop-first and tablet-supported;
- management phone layouts show summaries and practical approval views only;
- visible focus, sufficient contrast, labels, reduced motion, and practical 200% zoom;
- no emoji used as interface icons;
- synthetic data is clearly labeled;
- historical imported records appear read-only;
- approximate profitability is visibly approximate;
- failure, warning, empty, loading, and success visual states are designed, even though they are static.

## 6. Controlled visual directions

Explore exactly three deliberately different directions. Use the same Arabic labels, data, screen anatomy, viewport, and content in each direction so the comparison is about design rather than changed requirements.

### Direction A — Modern Industrial

- Navy `#0F2747`, teal `#0F766E`, amber `#D97706`, danger red `#B91C1C`, pale background `#F6F8FB`, white surface, and text `#172033`.
- Tajawal body/data and Alexandria headings/actions.
- Restrained depth, crisp cards, clear operational status, balanced density.
- Professional, practical, and recognizably industrial without looking old.

### Direction B — Calm Enterprise

- Cobalt `#2457C5`, cool slate `#52657A`, mint `#2A9D8F`, background `#F4F7FB`, white surface, text `#1E293B`, warning `#C47A12`, and danger `#C2414A`.
- Modern Arabic sans typography with slightly more whitespace.
- Quiet depth, softer borders, calm information hierarchy.
- Trustworthy and approachable without becoming generic consumer SaaS.

### Direction C — Precision Operational

- Ink `#20252B`, safety amber `#D48A17`, warm background `#F3F0E8`, surface `#FFFEFA`, text `#171A1D`, success `#2F7D57`, and danger `#B23A3A`.
- Strict grid, sharp hierarchy, low decoration, compact but readable tables.
- Swiss-inspired operational clarity with strong Arabic typography.
- Fast scanning for experienced office users while worker screens remain spacious.

Dark mode is outside this exploration unless the owner explicitly reopens it.

## 7. Workflow and approval gates

### Gate UX-0 — Freeze comparison content

Before generating visual alternatives, freeze:

- screen names and IDs;
- Arabic labels used in comparison screens;
- synthetic fixture values;
- target viewports;
- information shown and hidden for each role.

Visual agents may rearrange presentation but must not add modules, actions, metrics, or business rules.

### Gate UX-1 — Compare three directions

Generate these reference screens in all three directions:

1. Worker raw-material receipt at 390 px width.
2. Accountant approval/review queue at 1440 px width.
3. Owner dashboard at 1440 px width.

This produces nine directly comparable screens. Do not generate the full ERP in three styles.

The owner reviews:

- first impression;
- Arabic readability;
- navigation clarity;
- information density;
- worker simplicity;
- form clarity;
- table scanability;
- alert hierarchy;
- palette and typography;
- whether it feels like a specialized yarn/manufacturing ERP.

### Gate UX-2 — Select and freeze one direction

Record:

- selected direction or an explicitly defined hybrid;
- exact semantic color tokens;
- typography families, weights, and sizes;
- spacing scale;
- radii, borders, shadows, and elevation;
- worker and management density rules;
- sidebar/header/navigation anatomy;
- cards, forms, tables, drawers, dialogs, tabs, filters, alerts, status chips, timelines, charts, empty states, and loading patterns;
- desktop, tablet, and worker-mobile breakpoints;
- approved reference screenshots.

Do not begin full-screen generation while the direction is still being debated.

### Gate UX-3 — Generate the complete screen set

Use `02_google_stitch_full_ui_prompt.md` after replacing its selected-direction block with the approved Gate UX-2 decisions.

All screens must be generated in one uninterrupted agent run and one Stitch project. Because Stitch creates screens individually, the agent must use a new-screen generation operation for every screen. It must never edit a previously generated screen.

A direct conversational Stitch prompt may encounter generation-count limits. The reliable automation path is an agent using Stitch MCP/SDK in one process: create one project, call new-screen generation once for each manifest ID, and never call the existing-screen edit operation. A platform limit must be reported honestly rather than hidden by omitted or combined screens.

Every generated screen receives a stable ID and name. Once generated, it is frozen. If a correction is necessary, create a new version such as `INV-01-R2`; never overwrite `INV-01`.

### Gate UX-4 — Build the optional static prototype

Only after the full screen set is accepted, a coding agent may build a static prototype using `03_static_prototype_coding_agent_prompt.md`.

The static prototype must reproduce the approved screens. It must not reinterpret the visual system, redesign screens while coding, or add backend-like behavior.

### Gate UX-5 — Owner walkthrough and handoff

Walk through the prototype by role:

- Warehouse worker;
- Production worker;
- Quality worker;
- Accountant;
- Owner.

Record each comment as one of:

- visual defect;
- usability defect;
- terminology question;
- missing screen/state;
- possible business-rule change for the real plan;
- out of scope.

A possible business-rule change is not silently implemented here. It is sent back to the authoritative ERP decision process.

## 8. Anti-hallucination and screen-preservation rules

Every design or coding agent must obey:

1. Maintain an explicit screen manifest with stable IDs.
2. Generate or implement one new screen target at a time inside the same uninterrupted run.
3. Never apply a broad instruction such as “update all screens” after screen production begins.
4. Never edit an already frozen original screen.
5. If a new screen reveals an inconsistency, record it; do not retroactively change earlier screens.
6. Corrections create versioned copies and preserve originals.
7. Use shared tokens/components for consistency, but do not regenerate existing screens when adding a component.
8. End with a manifest containing every requested ID, its status, and any replacement version.
9. Do not silently omit, combine, rename, or redesign requested screens.
10. If a platform limit prevents completion, stop with an omission report; do not claim that all screens were generated.

## 9. Static data rules

- Use clearly fictional Arabic company, customer, supplier, and factory names.
- Reuse the same fixture values across visual directions.
- Use realistic yarn quantities and codes only as visual content.
- Do not use historical source files or real client records.
- Place `نموذج واجهة فقط — بيانات تجريبية غير حقيقية` visibly in the prototype shell.
- Values do not need to reconcile financially or operationally because no business logic is being evaluated.
- Do not let fake values imply that a posting, approval, backup, restore, or migration has actually occurred.

## 10. Acceptance criteria

The UI/UX exploration is complete only when:

- one visual direction is explicitly approved;
- the design-system decision sheet is complete;
- every required screen ID exists in the final manifest;
- all original generated screens remain preserved;
- Arabic RTL and mixed-direction content have been visually checked;
- worker screens contain no financial complexity;
- management tables remain readable and navigable;
- required responsive reference sizes are covered;
- static/non-operational status is unmistakable;
- owner review comments are resolved or recorded;
- the handoff distinguishes visual decisions from unresolved business decisions.

## 11. Relationship to the real ERP

Accepted design artifacts may later inform a controlled update to the real Design System and Frontend Screen contracts. They do not update those contracts automatically.

The real frontend must still integrate server-authoritative permissions, validation, posting commands, errors, idempotency, audit evidence, and tests. Pixel similarity to this prototype is not evidence of operational correctness.
