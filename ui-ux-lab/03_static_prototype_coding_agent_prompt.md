# Deterministic Coding-Agent Prompt — Static UI/UX Prototype

Use this with OpenCode, Antigravity, or another coding/design agent after the visual direction is approved.

This prompt is intentionally deterministic. Do not treat it as a loose creative brief.

---

Build a static Arabic-first UI/UX prototype for the ERP Yarn project.

This is **not** the real ERP MVP and must not be presented as operational software.

## 1. Required context to read

Read:

- `/ui-ux-lab/00_standalone_ui_ux_plan.md`;
- `/ui-ux-lab/02_google_stitch_full_ui_prompt.md` for the 46-screen manifest and screen IDs;
- `docs/00_project_context.md` for business context if available;
- `docs/contracts/02_design_system_and_ux_contract.md` for UX constraints if available;
- `docs/contracts/10_frontend_screen_contracts.md` for real frontend screen boundaries if available;
- the owner-approved screenshots/exports from the UI exploration;
- any owner-provided Excel screenshots only for naming/terminology inspiration, never as real data.

If any source conflicts with this prompt, preserve the safety rules here and report the conflict instead of guessing.

## 2. Authority and boundaries

Put all prototype code in a separately named prototype directory and work on a dedicated UI-lab branch.

Do not modify:

- `/docs/contracts`;
- `/docs/execution`;
- the real application;
- database files;
- migrations;
- backend work packages.

Do not add:

- server-side code;
- API routes;
- database or cloud SDKs;
- authentication logic;
- Supabase;
- Firebase;
- secrets;
- real mutations;
- real client data;
- business calculations or posting logic;
- accounting, inventory, WIP, approval, migration, backup, audit, permission, or profitability logic.

Use fixture modules only. No environment variables are needed.

## 3. Approved visual direction

Use **Calm Enterprise** as the fixed visual direction.

Visual feeling:

- professional;
- calm;
- modern;
- trustworthy;
- clean;
- easy to scan;
- specialized for yarn trading and outsourced manufacturing.

Palette:

- primary cobalt blue: `#2457C5`;
- slate neutral: `#52657A`;
- mint/teal accent: `#2A9D8F`;
- background: `#F4F7FB`;
- card/surface: `#FFFFFF`;
- main text: `#1E293B`;
- warning amber: `#C47A12`;
- danger red: `#C2414A`;
- calm success green close to the mint accent.

Do not explore new styles. Do not switch palettes while implementing later screens.

## 4. Global UI rules

- Root is Arabic RTL: `<html lang="ar" dir="rtl">`.
- Use Western numerals.
- Display dates as `DD/MM/YYYY`.
- Locally isolate LTR values: codes, batch IDs, lot IDs, document IDs, dates, quantities, money, emails, phone numbers, URLs, and technical identifiers.
- Every shell must show: `نموذج واجهة فقط — بيانات تجريبية غير حقيقية`.
- Use one professional SVG icon family. No emoji icons.
- Management screens are desktop-first and tablet-supported.
- Worker screens support 360px and above with 44px minimum touch targets.
- All operational buttons must be disabled or visibly labeled `عنصر عرض غير تشغيلي`.
- Navigation, filters, drawers, accordions, tabs, and chart hovers may work visually with fixture data only.
- No button may claim that a real posting, approval, backup, restore, migration, payment, or permission change happened.

## 5. Business framing rules

This ERP is for yarn trading and outsourced manufacturing.

External factories are inventory/WIP locations and service providers. Do not design the product like an internal machine/factory-floor system.

Forbidden dashboard terms/ideas:

- `كفاءة الإنتاج` as an owner KPI;
- machine utilization;
- shift efficiency;
- worker productivity;
- production-line efficiency;
- active machine orders;
- any metric that assumes the client manufactures everything internally.

Use outsourced-manufacturing wording instead:

- خام لدى المصانع الخارجية;
- تشغيل لدى مصنع خارجي;
- أوامر تشغيل مفتوحة;
- كميات خام مصروفة للتشغيل;
- كميات منتج مستلمة;
- هالك / مرتجع من التشغيل;
- مستحقات مصانع خارجية;
- عمليات تحتاج مراجعة;
- تحذيرات مخزون / جودة / ترحيل تاريخي.

## 6. Deterministic interaction requirements

### Worker missing-choice rule

Worker forms may use predefined dropdowns/comboboxes for materials, factories, locations, test types, references, and similar routine values.

If the required option is missing:

- provide `غير موجود في القائمة` / `Other / not listed`;
- allow a short temporary description/note;
- visually mark the record as needing review;
- do not automatically create official master data;
- do not block the worker from saving/submitting the static fixture.

### Sidebar rule

The Management Console must have:

- RTL side menu;
- always-visible whole-sidebar toggle;
- expanded state with icons + Arabic labels;
- collapsed state with icons only;
- main navigation grouped under collapsible categories;
- each category independently expandable/collapsible.

Suggested categories:

- لوحة التحكم;
- المخزون;
- التشغيل الخارجي / WIP;
- المبيعات;
- الجودة والمرتجعات;
- الحسابات والمراجعات;
- التقارير;
- الإدارة.

Worker mode must not use a complex management sidebar. It should use task cards and simple back-to-tasks navigation.

### Header utilities

The management header must include:

- quick search field;
- notification icon/bell;
- manual refresh icon/button;
- fake user/account area;
- static demo/environment label.

Quick search is visual/static only. It may show fixture suggestions for batch, lot, document, sale, customer, supplier, factory, complaint, migration batch, and traceability references.

Notifications are visual/static only. They may show new review items, warnings, complaints, corrections, migration warnings, and backup/restore-test warnings.

Refresh is visual/static only. It may show a spinner or updated timestamp, but it must not fetch real data.

### Recent activity rule

Recent activity screens must use stacked expandable strips/cards.

Important: this is a multi-open accordion. Opening one activity must not close previously opened activities.

Each activity strip may show:

- operation type;
- code/reference;
- status;
- actor;
- date/time;
- short summary;
- expandable details.

### Dashboard KPI navigation rule

Dashboard KPI cards/numbers must be clickable navigation shortcuts.

Clicking a KPI must not perform an operation. It only navigates to the corresponding static detail screen, preferably with a visual filter selected.

Required examples:

- إجمالي المخزون المتاح -> inventory balances;
- خام لدى المصانع الخارجية -> inventory balances filtered by external-factory locations;
- مبيعات هذا الشهر -> sales list filtered to current month;
- عمليات تحتاج مراجعة -> Review Center;
- تحذيرات مهمة -> Review Center or warning-filtered screen;
- شكاوى مفتوحة -> quality and complaints;
- ربحية تقريبية -> reports/profitability summary;
- مستحقات مصانع خارجية -> party statements filtered to factories;
- أوامر تشغيل مفتوحة -> WIP overview.

### Dashboard/review-center rule

The dashboard must never become the main work queue.

Owner dashboard:

- high-level KPI cards;
- total required reviews card;
- total important warnings card;
- clear charts;
- latest activity timeline;
- navigation to detailed pages.

Do not place detailed review tables on the dashboard.

Review Center / `APPR-01-REVIEW-QUEUE`:

- review counts by category;
- filters;
- review table;
- persistent detail drawer;
- review/audit log.

The review/audit log must show fixture columns for:

- who entered the data;
- when it was entered;
- department;
- operation type;
- current status;
- last review action.

Use neutral page colors with status/category chips. Do not color whole departments differently unless explicitly approved later.

### Chart behavior rule

The dashboard should invest in useful charts, but not decorative noise.

Use charts such as:

- stock by location/factory;
- external-factory stock distribution;
- monthly sales trend;
- review/warning trend;
- complaints by status;
- top items by available quantity if it fits the approved visual style.

Charts must have:

- hover tooltips;
- active bar/segment highlighting;
- subtle entry animation;
- accessible text summary;
- reduced-motion fallback.

Bar charts may animate upward/outward. Pie/donut charts may draw/rotate smoothly. Keep motion subtle and Calm Enterprise.

### KPI card layout rule

KPI cards are rectangular cards. They may wrap to multiple rows. Do not squeeze too many cards into one row.

### User management rule

User management must show:

- users;
- roles;
- active/inactive status;
- exact effective permissions by screen/action/role where possible;
- permission/audit logs.

Permission editing may be disabled, read-only, marked deferred, or limited to an owner/setup-only visual state. Do not implement real permission changes.

### Logs rule

Important management screens should expose visual logs/audit history where relevant:

- who entered data;
- who reviewed it;
- when;
- status;
- last action;
- correction request.

### AI feature rule

AI summarization, Q&A, and data assistant features are deferred. Do not implement them. If shown at all, show only a small disabled/future marker, not a primary feature.

## 7. Phased implementation plan

Implement in phases. At the end of every phase, run:

1. visual review;
2. requirement coverage review;
3. forbidden-term review;
4. route/screen completeness review;
5. RTL/LTR and responsive spot check.

### Phase 1 — Shell and navigation

Build:

- Arabic RTL root;
- synthetic-data banner;
- management shell;
- collapsible grouped RTL sidebar;
- header quick search;
- notification icon;
- manual refresh button;
- screen index;
- worker task shell/home;
- management console shell.

Test:

- sidebar expanded/collapsed;
- categories independently expanded/collapsed;
- header utilities visible;
- 1440px management layout;
- 390px worker layout.

### Phase 2 — Dashboard and Review Center

Build:

- owner dashboard;
- accountant dashboard;
- Review Center / approval queue.

Test:

- dashboard is simple and insight-first;
- dashboard KPI cards navigate to detail screens/filters;
- review details live in Review Center;
- forbidden internal-manufacturing KPIs are absent;
- charts have hover/animation/accessibility summary.

### Phase 3 — Worker task screens

Build warehouse, production, and quality worker screens from the 46-screen manifest.

Test:

- worker screens are simple;
- worker touch targets are at least 44px;
- worker screens contain no financial/accounting complexity;
- missing dropdown options use the safe "other / not listed" review-needed path;
- recent activity uses multi-open expandable strips/cards.

### Phase 4 — Management operation screens

Build inventory, WIP, sales, payments, party statements, direct costs, quality/returns, and traceability screens.

Test:

- tables are readable and consistent;
- filters/drawers/status chips work visually;
- no fake posting success;
- no direct balance editing;
- outsourced-manufacturing wording is used.

### Phase 5 — Migration, reports, backup, admin

Build historical migration, reports, backup/restore status, users/roles, and settings screens.

Test:

- historical imported records look locked/read-only;
- migration is clearly staging/validation/approval/locked oriented;
- exports are not called backups;
- backup screen does not imply restore has been proven unless fixture explicitly says so;
- user management shows exact permissions and logs;
- permission editing is disabled/deferred/setup-only.

### Phase 6 — Final verification

Verify:

- all 46 screen IDs/routes exist;
- all required screens are reachable from the index;
- sidebar toggle works visually;
- grouped sidebar categories work visually;
- dashboard KPI card navigation works visually;
- dashboard is not overloaded;
- Review Center contains detailed review work;
- worker screens contain no financial/accounting terms;
- quick search, notifications, and refresh are static/visual only;
- Arabic RTL and LTR isolation are correct;
- no backend/cloud/secrets were added;
- all operational actions are static/non-operational.

## 8. Verification commands and evidence

Run the checks available in the chosen stack, such as:

- formatting;
- lint;
- typecheck;
- component/unit tests where available;
- production build;
- route smoke checks;
- accessibility smoke checks;
- RTL/LTR checks;
- responsive screenshots;
- secret scan.

Visual review must compare:

- approved reference screens first;
- every implemented route against its intended screen ID;
- worker financial redaction;
- sidebar behavior;
- dashboard KPI navigation;
- chart hover/animation behavior;
- recent activity multi-open accordions;
- typography, colors, spacing, density, borders, radii, shadows, icons, and responsive behavior.

## 9. Completion report

Provide:

1. branch and commit;
2. complete 46-screen route manifest;
3. phase-by-phase completion notes;
4. tests and build results;
5. screenshot or visual evidence for key screens;
6. responsive checks;
7. forbidden-term scan result;
8. known visual mismatches;
9. confirmation that no backend/cloud/secret was added;
10. confirmation that completed earlier screens were not changed unintentionally while implementing later screens.

Do not call this the completed ERP MVP. Call it **ERP Yarn Static UI/UX Prototype**.

---
