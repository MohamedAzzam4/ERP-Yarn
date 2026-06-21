# Design System and UX Contract

## Contract Status

This is the binding design-system and user-experience contract for the Specialized Yarn Trading & Outsourced Manufacturing ERP. It defines the visual direction, role-based UX modes, Arabic/RTL behavior, typography, responsive behavior, forms, tables, dashboards, motion, accessibility, visual QA, and frontend approval gates.

This document does not define individual screen data contracts or business posting rules. The later frontend screen contract must apply this system to each screen without changing the domain, permission, approval, inventory, WIP, subledger, or migration contracts.

Research and decision date: **2026-06-20**.

## Authority and Required Reading

This contract must be read with:

1. `docs/00_project_context.md`;
2. `docs/01_final_implementation_plan_v4.md`;
3. `docs/02_decision_log_and_scope.md`;
4. `docs/contracts/01_technical_architecture_and_deployment_contract.md`;
5. the permission matrix, API contract, frontend screen contract, and testing contract when they exist.

Where a visual treatment could expose restricted data or alter a workflow, the business and permission contracts win. Attractive presentation never authorizes a worker to see financial information or bypass approval.

## Design-System Technology Baseline

| Concern | Binding choice | Version policy |
| --- | --- | --- |
| Component source | shadcn/ui open-code components | shadcn `3.5.0` baseline, reviewed before copying/updating components |
| Accessible primitives | Radix UI primitives used by the selected shadcn components | Exact compatible versions locked at Phase 0 |
| Styling | Tailwind CSS | Stable `4.x`; CSS-first theme configuration |
| Icons | Lucide | Exact stable version locked at Phase 0 |
| Forms | React Hook Form | `7.66.x` baseline |
| Validation | Zod | Stable `4.x` |
| Form-schema adapter | `@hookform/resolvers` | Exact version verified with React Hook Form and Zod at Phase 0 |
| Data tables | TanStack Table | Latest stable release verified at Phase 0; beta/RC releases prohibited |
| Charts | Recharts | `3.3.x` baseline through shared chart wrappers |

All exact installed versions must be recorded in the repository lockfile. Context7 must be consulted before installing or upgrading these libraries. A copied shadcn component becomes repository-owned source and must be reviewed like any other code; CLI updates must never overwrite custom behavior blindly.

## Product Experience Goals

The ERP must feel:

```text
modern industrial
structured
geometric
operational
professional
clear
fast
factory/workflow oriented
```

It must not feel like a generic accounting template, a decorative consumer application, or an AI-generated dashboard collage.

The quality of the interface comes primarily from hierarchy, typography, spacing, consistent states, accurate content, and low cognitive load—not visual effects.

Avoid:

- excessive gradients;
- glassmorphism;
- overly soft or inflated cards;
- heavy dark-mode-first visuals;
- decorative charts;
- excessive shadows;
- animated backgrounds;
- unnecessary motion;
- crowded enterprise screens that expose every possible field at once.

## MVP Theme Scope

The MVP is **light-theme only**. Dark mode is deferred.

The theme is centrally configurable through semantic CSS variables and Tailwind v4 theme mappings. There is no end-user theme editor in MVP.

Initial color values are provisional until the three reference screens pass owner visual approval. The token structure and semantic use are binding even while values are calibrated.

Changing the approved palette later must require edits only in the central theme layer, not component-by-component color replacement.

## Semantic Design Tokens

At minimum, define central semantic tokens for:

```text
--color-background
--color-surface
--color-surface-elevated
--color-foreground
--color-muted
--color-muted-foreground
--color-primary
--color-primary-foreground
--color-accent
--color-accent-foreground
--color-border
--color-input
--color-ring
--color-overlay

--color-success
--color-success-foreground
--color-warning
--color-warning-foreground
--color-danger
--color-danger-foreground
--color-info
--color-info-foreground

--color-pending
--color-approved
--color-rejected
--color-blocked
--color-negative-stock
--color-needs-review

--color-sidebar
--color-sidebar-foreground
--color-sidebar-active
--color-chart-1
--color-chart-2
--color-chart-3
--color-chart-4
--color-chart-5
```

Tailwind v4 maps these variables to semantic utilities such as:

```text
bg-background
bg-card
text-foreground
text-muted-foreground
border-border
ring-ring
text-destructive
```

Components must use semantic utilities. They must not encode design intent with literal utilities such as `bg-blue-900`, `text-gray-700`, or `border-slate-200`. Direct variable references are limited to the central theme layer or an exceptional shared primitive where semantic utility mapping cannot express the requirement.

Color must never be the only carrier of status or severity. Every critical state uses visible Arabic text and, where helpful, a consistent icon.

## Typography

### Font Families

```text
Body, tables, forms, worker screens: Tajawal
Headings, sidebar, dashboard titles, buttons: Alexandria
Fallback: Noto Sans Arabic, then suitable system sans-serif
```

Fonts must be loaded through the Next.js font pipeline or self-hosted assets so the application does not depend on a third-party runtime font request. Load only required weights.

Recommended initial weights:

```text
Tajawal: 400, 500, 700
Alexandria: 500, 600, 700
```

Do not use decorative or calligraphic Arabic fonts for operational content. Table and form text must remain readable at normal desktop density and at 200% zoom.

### Type Hierarchy

The design system must define named styles for:

- page title;
- section title;
- card title;
- body;
- compact table body;
- label;
- helper text;
- validation message;
- numeric KPI;
- code/identifier;
- status badge.

Headings must communicate hierarchy without relying only on size. Avoid excessive uppercase English text inside Arabic layouts.

## Arabic-First Root Direction

The application root must use:

```html
<html lang="ar" dir="rtl">
```

Arabic UI sentences and critical messages default to RTL. Do not rely on `dir="auto"` for full sentences, alerts, validation, approval reasons, or transactional confirmation messages.

Do not allow an English word or code at the beginning of a sentence to flip the entire message to LTR. Rewrite the surrounding label/message as Arabic RTL and isolate only the English/code/value segment.

## Local LTR Isolation

Local LTR isolation is required for:

- document codes;
- batch codes;
- lot codes;
- emails;
- phone numbers;
- URLs;
- dates;
- quantities;
- monetary values;
- factory rates and unit costs;
- numeric table cells;
- technical identifiers.

Dynamic mixed-direction values use:

```html
<bdi dir="ltr">...</bdi>
```

or one equivalent shared `BidiValue` component that applies LTR direction and Unicode bidirectional isolation. Form inputs for these values use local LTR input direction while labels and help text remain RTL.

Use logical layout properties and utilities rather than left/right assumptions. Directional icons such as next/previous arrows, chevrons, and drawer direction must mirror appropriately. Non-directional icons such as save, warning, calendar, factory, and document must not be mirrored merely because the page is RTL.

## Date, Timezone, and Number Formatting

### Display Dates

Display date format:

```text
DD/MM/YYYY
```

Example:

```text
20/06/2026
```

Displayed dates use Western numerals and local LTR isolation.

### Internal Dates

- Database/API date-only values use ISO-compatible `YYYY-MM-DD` semantics.
- Date-only values must not be converted through a timezone in a way that shifts the calendar day.
- Database timestamps use timezone-aware timestamp semantics and API timestamps use ISO-compatible values.
- Display timestamps convert through the tenant timezone.
- Current-client default timezone is `Africa/Cairo`.
- Timezone remains a tenant-level controlled setting.

### Numerals

Use Western numerals throughout the ERP:

```text
123
4,250 kg
127,500 جنيه
20/06/2026
```

Formatting should use a locale/numbering-system configuration equivalent to `ar-EG-u-nu-latn`, preserving Arabic language while forcing Latin digits. Do not implement numeral conversion through scattered string replacements.

### Numeric Precision

The future database schema contract must enforce:

```text
kg quantities: DECIMAL(18,3)
monetary amounts: DECIMAL(18,2)
factory_rate_per_ton: DECIMAL(18,2)
calculated unit costs when required: DECIMAL(18,6)
```

Frontend and API code must not use binary floating-point arithmetic as the authority for business totals. Values are transported as decimal-safe strings or another contract-approved representation and calculated/rounded according to backend rules.

Display rules:

- quantities show up to 3 decimal places and may omit trailing zeros;
- monetary amounts show up to 2 decimal places and may omit trailing zeros in summary display;
- factory rates show up to 2 decimal places;
- calculated unit costs show only the precision required by the screen, with full stored precision available to authorized detail/audit views;
- never hide a meaningful non-zero remainder through premature UI rounding;
- negative values show an explicit minus sign plus status text where the negative state is operationally significant.

## UX Modes

The product has two intentional UX modes. They share the same design tokens and component system but not the same information architecture.

### Worker Task Mode

Used by Warehouse, Production, and Quality/Data-entry users.

Principle:

> Worker screens are task-first, not module-first.

The home experience presents direct operations such as:

- استلام خام;
- نقل مخزون;
- استلام مرتجع;
- تسجيل إنتاج;
- تسجيل جودة.

Do not present workers with abstract module navigation such as “Inventory Management,” “Subledger,” or “Direct Costs.”

Worker Task Mode requires:

- few screens;
- large touch targets;
- minimal navigation;
- minimum required operational fields;
- clear defaults;
- clear save/draft/review actions;
- plain Arabic validation and recovery guidance;
- no prices, balances, payables, receivables, profitability, settlement, allocation, or accounting terminology;
- responsive browser support from 360px upward;
- minimal animation;
- safe save and Accountant Review routing for incomplete financial-adjacent data.

Worker screens must not be reduced-size versions of management screens.

### Management Console Mode

Used by Owner and Accountant.

Owner and Accountant share:

- application shell;
- sidebar/navigation logic;
- page hierarchy;
- table and filter patterns;
- details pages;
- approval drawers;
- dashboard card system;
- feedback and confirmation patterns.

Their differences come from backend-enforced permissions, visible fields, default dashboard widgets, and available actions—not separate visual languages.

Owner emphasis includes profitability, high-level KPIs, factory-held stock, approvals, alerts, and traceability drill-down.

Accountant emphasis includes payments, balances, cost review, settlements, missing-price receipts, migration warnings, and financial review queues.

## Responsive Contract

### Worker Task Mode

- Fully supported from 360px width upward.
- Primary actions remain reachable without precision tapping.
- Forms use one column on narrow screens and expand only when grouping remains clear.
- Sticky primary action areas may be used when they do not obscure content or keyboard focus.
- Simple lists may become cards on phone widths.
- Do not force wide management tables into worker flows.

### Management Console

- Desktop-first.
- Tablet-supported.
- Phone view supports summaries, alerts, and approvals only where practical.
- Dense balance, reconciliation, audit, and migration tables may use controlled horizontal scrolling or a summary-to-detail pattern on small screens.
- A phone layout must not silently omit critical values or expose restricted data.
- Unsupported high-density actions must communicate that a larger view is required rather than rendering a broken interface.

## Navigation and Information Architecture

### Worker Navigation

- task cards or large task buttons;
- no deep module tree;
- no financial menu entries;
- clear “back to tasks” route;
- current draft/review status visible;
- recent relevant operations only when useful.

### Management Navigation

- consistent sidebar using approved Arabic terminology;
- current section and page clearly indicated;
- breadcrumb or equivalent context on nested records;
- approval counts and critical alert counts may appear as restrained badges;
- permission-hidden destinations must not render or be discoverable through client navigation;
- global search is added only when its data scope and permission filtering are contracted.

## Forms Contract

Forms use React Hook Form, Zod 4 schemas, and accessible shadcn form primitives.

Required behavior:

- labels remain visible; placeholders do not replace labels;
- required and optional fields are distinguishable without color alone;
- validation runs at a useful moment, normally on blur and on submit, without noisy validation on every keystroke;
- field errors are linked with `aria-describedby`/`aria-invalid` behavior;
- an error summary appears for long forms or multiple failures;
- the first invalid field can be focused after failed submission without disorienting the user;
- server validation remains authoritative and maps errors back to fields/general messages;
- entered values remain available after a recoverable validation or server error;
- submit buttons show progress and prevent accidental duplicate submission;
- idempotency remains a backend/API responsibility, not only a disabled button;
- destructive or irreversible actions require explicit confirmation and reason where the business contract requires it;
- draft, submit-for-review, approve, reject, cancel, reverse, and correct actions must not be visually interchangeable;
- hidden financial fields must not be included in worker form payloads merely because CSS hides them.

Shared Zod schemas may express structural input validation on client and server, but business permission, state, stock, balance, and approval rules remain server-side.

Date and decimal inputs validate normalized strings. Coercion must not convert blank strings into unintended zero/date values.

## Tables and Data Grids

TanStack Table is a headless state/rendering engine; the ERP remains responsible for semantic table markup, accessibility, RTL, responsive behavior, and visual design.

Management tables require, as applicable:

- server-side pagination;
- server-side sorting;
- server-side filtering;
- stable URL/query state for important filters where appropriate;
- clear active-filter display and reset;
- loading, empty, error, and partial-data states;
- column visibility controlled by role/permission;
- numeric columns isolated LTR and aligned consistently;
- sticky headers only when they do not break keyboard/zoom behavior;
- row actions grouped consistently;
- selected/updated rows indicated by more than color;
- export actions shown only to authorized roles;
- no assumption that browser-side filtering protects restricted rows or fields.

Large datasets must not be loaded in full simply to support client-side table features. Virtualization may be added only where measured data volume justifies it and keyboard/accessibility behavior remains acceptable.

Worker flows should prefer short lists, cards, or focused task tables rather than dense configurable grids.

## Dashboard and Chart Rules

Dashboards communicate decisions and exceptions, not decoration.

### Owner Dashboard

May include:

- total stock;
- stock at external factories;
- pending approvals;
- negative-stock alerts;
- open complaints;
- approximate profitability with its label/profile state;
- customer and factory balance summaries;
- recent important operations.

### Accountant Dashboard

May include:

- sales/operations awaiting approval;
- receipts missing price;
- production requiring cost review;
- direct costs requiring review;
- unsettled payments;
- customer/supplier/factory balance summaries;
- historical migration warnings.

### Recharts Rules

- render through shared wrappers using semantic chart tokens;
- use responsive containers with a defined parent height/aspect;
- enable the Recharts accessibility layer where supported;
- provide visible labels, units, legend, and tooltip content in Arabic;
- provide numeric summary or table access to the underlying important values;
- do not rely on color alone to distinguish critical series;
- disable or reduce animation under `prefers-reduced-motion`;
- avoid chart animation in Worker Task Mode;
- use a chart only when it communicates a trend/comparison better than cards or a small table;
- never hide missing/incomplete profitability or reconciliation data behind a chart.

Charts are client-rendered components where required by the library, but their data remains permission-filtered and server-authorized.

## Feedback, States, and Confirmation

Every major interactive component must define:

- initial/empty state;
- loading/skeleton state;
- success state;
- recoverable validation state;
- permission-denied state;
- not-found state;
- conflict/idempotency state;
- backend failure state;
- offline/network failure guidance where relevant.

Toasts are suitable for short confirmation but must not be the sole record of a critical failure or approval result. Persistent blocking issues use an inline alert/banner with an actionable explanation.

After save, highlight the affected record subtly and expose its new status. Do not clear a form before the application confirms a successful save.

## Motion Contract

Motion is functional, restrained, fast, and never required to understand state.

Permitted timing ranges:

```text
micro-interactions: 100–150ms
modals/drawers: 150–220ms
toasts/alerts: 150–200ms
```

Permitted uses:

- modal/drawer open and close;
- button hover/focus;
- row highlight after save;
- toast entrance/exit;
- loading skeleton;
- status-change feedback;
- accordion expansion;
- subtle tab transitions.

Prohibited or strongly discouraged:

- large page transitions;
- bouncing cards;
- cinematic transitions;
- animated backgrounds;
- excessive chart animation;
- decorative motion in worker screens;
- pulsing as the only critical-alert treatment.

Respect `prefers-reduced-motion` and provide effectively static alternatives.

## Accessibility Contract

Target: **WCAG 2.2 AA**.

Required:

- complete keyboard operation for interactive controls;
- visible focus indicators;
- logical focus order in RTL;
- correct labels, names, roles, and states;
- semantic headings and landmarks;
- accessible form errors;
- minimum 44×44px worker touch targets;
- normal-text contrast of at least 4.5:1 and large-text/UI contrast appropriate to WCAG AA;
- status text/icons in addition to color;
- reduced-motion support;
- no focus traps except correctly managed modal/dialog behavior;
- 200% browser zoom without loss of operation or critical information;
- Arabic screen-reader labels for user-facing controls;
- keyboard-accessible tables, pagination, drawers, menus, dialogs, date controls, and approvals;
- text alternatives or accessible summaries for critical charts.

Accessibility is an acceptance criterion, not a later polish phase.

## Reference Screen Approval Gate

Before GLM scales the frontend to the complete screen set, it must create and receive owner approval for three reference screens:

1. **Worker raw-material receipt**.
2. **Accountant review queue**.
3. **Owner dashboard**.

These screens establish the approved baseline for:

- typography;
- spacing and density;
- provisional light-theme colors;
- cards, forms, tables, badges, alerts, drawers, and buttons;
- Arabic hierarchy and terminology;
- RTL/LTR isolation;
- responsive behavior;
- motion;
- accessibility;
- permission-safe information density.

### Worker Raw-Material Receipt Baseline

Expected operational fields:

- raw batch/message number;
- supplier;
- quantity in kg;
- bale count when known;
- receipt location;
- date;
- notes.

Expected actions:

- save draft;
- submit for review/approval.

Prohibited fields:

- price per ton;
- total cost;
- supplier balance;
- profitability.

### Accountant Review Queue Baseline

Must demonstrate:

- management shell and filters;
- review categories and counts;
- missing-price receipt;
- production/direct-cost review;
- payment/settlement warning;
- migration warning;
- permission-safe detail drawer;
- approve/reject/request-correction distinction.

### Owner Dashboard Baseline

Must demonstrate:

- clear high-level cards;
- factory-held stock;
- approvals and negative-stock alerts;
- complaint/quality warning;
- approximate profitability label;
- traceability/report drill-down;
- restrained chart use if a chart materially helps.

### Approval Evidence

Owner approval must record:

- screen version/reference;
- approved palette values;
- approved typography/density;
- accepted responsive states;
- accepted Arabic/RTL behavior;
- known visual limitations;
- decision date.

Until this gate passes, GLM may build shared primitives and reference screens but must not replicate an unapproved visual pattern across all modules.

## Visual QA Matrix

Every major screen must be checked in:

- Arabic RTL;
- mixed Arabic/English content;
- Western numerals;
- `DD/MM/YYYY` dates;
- long Arabic labels;
- document/batch/lot codes with isolated LTR direction;
- realistic large quantities and monetary values;
- desktop width;
- tablet width;
- 360px worker width;
- management phone summary/approval view where supported;
- keyboard-only operation;
- reduced motion;
- 200% zoom;
- loading, empty, error, permission-denied, and success states.

Components requiring explicit RTL/bidirectional QA:

- dialogs;
- drawers;
- sidebars;
- tables;
- pagination;
- dropdowns/comboboxes;
- date controls;
- forms and validation summaries;
- toasts and persistent alerts;
- charts and tooltips;
- directional icons;
- breadcrumbs;
- keyboard navigation and focus movement.

Visual QA must include screenshots or equivalent evidence for the three reference screens at their required breakpoints.

## Permission and Data-Exposure Rules

Presentation logic is not permission enforcement.

- Backend/API responses must omit forbidden fields.
- Worker screens and payloads must not contain hidden financial data.
- Owner/Accountant differences come from authorized data/actions.
- Export controls follow the permission matrix.
- Chart and dashboard aggregates are financial data when derived from prices, balances, cost, or profitability and require the same permission protection as their detailed sources.
- URL parameters, client state, local storage, and disabled controls must not reveal or authorize restricted actions.

## Explicit Non-Goals

The MVP design system does not include:

- dark mode;
- an end-user theme editor;
- a native mobile application;
- decorative data visualization;
- full dashboard customization;
- drag-and-drop layout builders;
- user-defined table schemas;
- a second non-Arabic primary UI;
- flashy page transitions;
- a separate visual system for Owner and Accountant;
- financial complexity on worker screens.

## Acceptance Criteria

The design system is ready for broad frontend implementation only when:

- the three reference screens are owner-approved;
- the initial light-theme token values are recorded;
- Arabic RTL and local LTR isolation pass visual QA;
- Worker Task Mode works from 360px upward with 44×44px targets;
- the Management Console works on desktop and tablet;
- dates, timezone conversion, Western numerals, and decimal formatting follow this contract;
- forms and tables demonstrate accessible error/loading/empty states;
- role-based information exposure matches the permission rules;
- keyboard, focus, reduced-motion, contrast, and 200% zoom checks pass;
- no screen depends on literal colors or color-only status;
- visual polish does not weaken operational clarity or business safeguards.

## Deferred Decisions

The following are intentionally deferred until the reference-screen gate or later productization:

1. Final light-theme token values—the initial provisional values are approved through reference screens.
2. Dark-mode palette and behavior.
3. Additional chart types beyond the approved reference dashboard.
4. User-customizable dashboard layouts or themes.

Deferred decisions must not be invented by GLM.
