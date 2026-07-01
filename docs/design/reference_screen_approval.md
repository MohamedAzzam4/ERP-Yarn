# Reference Screen Approval Record

## 1. Status

**reference-screens-v1: APPROVED** — all three reference screens are owner-approved as of 2026-07-01.

This file is the canonical repository approval record for the reference-screen gate. It resolves the storage/sign-off mechanism required by `PCD-UX-002` (per `DEC-079`) and now records the owner's formal visual approval of the three reference screens built in `WP-01-05`, `WP-01-06`, and `WP-01-07`.

With this approval recorded, the **WP-01-08 Reference-Screen Approval Gate** is satisfied. Broad frontend expansion (Phase 2 management screens, Phase 3 inventory/transfer screens, Phase 4 production screens, Phase 5 quality/complaint/traceability screens) is now unblocked, provided each downstream package still meets its own contract, permission, redaction, and test gates.

## 2. Approval Mechanism

Reference-screen approval is versioned, not permanent.

For each approval version, store:

- fixture version;
- screen version;
- screenshot or equivalent visual evidence path;
- palette/token notes;
- typography and density notes;
- accepted breakpoints;
- Arabic/RTL/LTR behavior notes;
- accessibility and reduced-motion notes;
- known limitations;
- owner decision;
- decision date.

Evidence should be stored under:

```text
docs/design/evidence/reference-screens/<version>/
```

If screenshots are too large for the repository, store a concise repository note with stable external evidence location and checksum/metadata. Do not store secrets, real client data, production data or private credentials in approval evidence.

## 3. Change Policy

Changing screens later does not break the ERP if the change is handled through a new version.

- Visual-only changes require visual, responsive, accessibility and regression evidence.
- Business behavior, permission behavior, API fields, command semantics or data meanings require contract and test updates.
- Worker financial redaction, backend authorization and domain contracts remain binding regardless of visual approval.

## 4. Approval Records

### reference-screens-v1 — APPROVED 2026-07-01

#### 4.1 Owner decision

| Field | Value |
| --- | --- |
| Owner decision | **Approved** |
| Decision date | 2026-07-01 |
| Approved main commit | `040252ba23e9fa8abb1b1566a60b504183ac11eb` |
| Approved source branch | `phase/01-reference-screens-bundle` |
| Approved preview URL | `https://erp-yarn-git-phase-01-reference-screens-bundle-azzam-s-team.vercel.app/management/dashboard` |
| Fixture version | `reference-fixtures-v1` (`src/lib/fixtures/reference-fixtures.ts`) |
| Approval gate work package | WP-01-08 |
| Approval mechanism | DEC-079 |

The owner visually reviewed the deployed Vercel Preview after the collapsed-sidebar layout fix (commit `040252b`) and approved all three reference screens. The approval covers the visual direction, layout, hierarchy, interaction model, and accessibility baseline documented below. It does **not** constitute approval of final transaction logic, production data readiness, or full business workflow implementation (see §4.9 Known limitations).

#### 4.2 Approved screens

| Screen | WP | Route | Fixture | Decision | Date |
| --- | --- | --- | --- | --- | --- |
| Worker raw-material receipt data-entry | WP-01-05 | `/worker/raw-receipts/new` | reference-fixtures-v1 | Approved | 2026-07-01 |
| Accountant review queue | WP-01-06 | `/management/reviews` | reference-fixtures-v1 | Approved | 2026-07-01 |
| Owner dashboard | WP-01-07 | `/management/dashboard` | reference-fixtures-v1 | Approved | 2026-07-01 |

#### 4.3 Approved visual direction

| Dimension | Approved value |
| --- | --- |
| Visual direction | Calm Enterprise |
| Language/root | Arabic-first, `<html lang="ar" dir="rtl">` |
| Theme | Light-only MVP (DEC-039); dark mode deferred |
| Primary brand color | `--color-primary: #2457c5` (blue/navy) — stronger brand presence applied to management surfaces |
| Glassmorphism | Restrained, management-only (DEC-076): dashboard header `backdrop-blur-md`, insight widget cards `backdrop-blur-sm` + `bg-surface/80`, topbar `backdrop-blur-sm`. **Prohibited** on Worker Task Mode screens and behind KPI financial numbers. |
| KPI card styling | Clean white `bg-surface` card; no thick top strip; no corner glow blob; subtle 3px RTL vertical accent line (`w-[3px]` right-0, inset top-5 bottom-5, `rounded-full`); semantic color per KPI category (primary/accent/success/warning/danger); small tinted semantic status chip; KPI numbers on solid surface (no glass), `text-2xl font-bold text-foreground tabular-nums` |
| Chart interactions | Power BI-style hover/focus on all dashboard charts (donut, attention ranking, factory balances, location bars, review trend, complaints): hovered/focused item highlights (opacity 1 + wider stroke/bold), others de-emphasize (opacity 0.35–0.55). `tabIndex=0` + `role="button"` + `cursor: pointer` on all chart parts. Transitions 150–300ms (`duration-200`). `prefers-reduced-motion` respected via globals.css. No layout-shifting scale effects. |
| Sidebar | Compact `h-14` branded header row pairing brand mark + "القائمة" title + collapse toggle (expanded); clean dot marks + toggle (collapsed, 64px). Toggle flush/transparent, 44×44 touch target, Arabic aria-label, double-chevron panel icon. Active nav item: `bg-primary/10` + `font-bold` + `text-primary` + `ring-primary/20` + right-edge accent bar. |
| Topbar | Blue gradient background (`from-primary/5`), branded "E" logo mark, `text-primary` title. Reserves right space for sidebar (`lg:pr-16` collapsed / `lg:pr-64` expanded) to prevent title/subtitle collision. |
| Worker screen | Simple, task-first; no glass, no heavy brand gradients, no primary-tinted card backgrounds. Plain `Card` components only. |
| Focus states | Visible `focus-visible:ring-2` ring throughout; `prefers-reduced-motion` global override in globals.css |
| Touch targets | 44×44px minimum on all worker form controls, buttons, and sidebar toggle (WCAG 2.2 AA, DEC-044) |

#### 4.4 Approved palette values (provisional → approved)

The provisional palette values in `src/app/globals.css` are now **approved** as the v1 light-theme baseline (DEC-039 reference-screen gate satisfied). Future calibration changes require a new approval version.

| Token | Value | Status |
| --- | --- | --- |
| `--color-primary` | `#2457c5` | Approved v1 |
| `--color-primary-foreground` | `#ffffff` | Approved v1 |
| `--color-accent` | `#2a9d8f` | Approved v1 |
| `--color-success` | `#2a9d8f` | Approved v1 |
| `--color-warning` | `#c47a12` | Approved v1 |
| `--color-danger` | `#c2414a` | Approved v1 |
| `--color-info` | `#2457c5` | Approved v1 |
| `--color-background` | `#f4f7fb` | Approved v1 |
| `--color-surface` | `#ffffff` | Approved v1 |
| `--color-foreground` | `#1e293b` | Approved v1 |
| `--color-muted-foreground` | `#64748b` | Approved v1 |
| `--color-border` | `#e2e8f0` | Approved v1 |
| `--color-ring` | `#2457c5` | Approved v1 |
| Chart palette (`--color-chart-1..5`) | `#2457c5 / #2a9d8f / #c47a12 / #52657a / #c2414a` | Approved v1 |
| Sidebar (`--color-sidebar`, `--color-sidebar-active`) | `#ffffff / #2457c5` | Approved v1 |

#### 4.5 Approved typography and density

| Element | Approved value |
| --- | --- |
| Body font | Tajawal (`--font-sans`) |
| Heading font | Alexandria (`--font-heading`) |
| Page title | `.text-page-title` 1.5rem/700 |
| Section title | `.text-section-title` 1.25rem/600 |
| Card title | `.text-card-title` 1.125rem/600 |
| Body | `.text-body` 0.875rem/400 |
| KPI number | `text-2xl font-bold tabular-nums` on `bg-surface` |
| Code/identifier | `.text-code-identifier` mono, LTR isolated |
| Status badge | `.text-status-badge` 0.6875rem/600 |
| Card padding | `p-4` (KPI), `p-4 pt-5` (KPI with accent), `p-3` (summary count cards) |
| Grid density | KPI cards `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4`; insight widgets `lg:grid-cols-3 gap-4`; review queue summary `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3` |

#### 4.6 Accepted breakpoints

| Breakpoint | Behavior verified |
| --- | --- |
| Mobile (`<sm`, default) | Single-column KPI/insight grid; sidebar overlay (off-canvas) with hamburger toggle in topbar; worker form full-width |
| `sm` (≥640px) | KPI grid 2 columns; review queue summary 3 columns |
| `lg` (≥1024px) | KPI grid 4 columns; insight widgets 3 columns; sidebar persistent (desktop); topbar reserves sidebar space via `lg:pr-16`/`lg:pr-64`; main content `lg:mr-16`/`lg:mr-64` |

Responsive behavior verified on the deployed Vercel Preview at standard desktop (1280px) and narrow viewports via browser validation.

#### 4.7 Accepted Arabic/RTL/LTR behavior

| Behavior | Status |
| --- | --- |
| Root `<html lang="ar" dir="rtl">` | Verified (no `dir="auto"` on critical Arabic sentences) |
| Sidebar on right edge (RTL) | Verified — `fixed inset-y-0 right-0`; collapsed width 64px stable |
| Active nav accent bar on right (leading RTL edge) | Verified |
| LTR isolation for codes/dates/numbers | Verified — `dir="ltr"` on worker form code/date/quantity inputs; `LtrValue` component for dashboard/review-queue values |
| Arabic aria-labels | Verified — sidebar toggle (`توسيع/طي القائمة الجانبية`), disabled approval buttons (`اعتماد/رفض (غير متاح - شاشة مرجعية)`), login errors (`خطأ في تسجيل الدخول`) |
| Arabic business terminology | Per DEC-077 — fixture-pinned `reference-fixtures-v1`; no changes without owner-review |

#### 4.8 Accessibility and reduced-motion notes

| Requirement | Status |
| --- | --- |
| WCAG 2.2 AA target | Met — visible `focus-visible:ring-2` throughout, 44×44 touch targets, contrast preserved |
| `prefers-reduced-motion` | Respected — globals.css global override sets `animation-duration: 0.01ms` and `transition-duration: 0.01ms` for all elements when reduced-motion is requested |
| Chart keyboard focus | All chart segments/points/legend items are `tabIndex=0` + `role="button"` with `onFocus`/`onBlur` handlers matching hover behavior |
| Disabled controls | Review-queue approve/reject buttons `disabled` + `opacity-50` + colored-border + Arabic aria-label; no fake approval actions |
| Screen reader labels | Collapsed sidebar nav dots carry `aria-label={item.labelAr}` + `title={item.labelAr}`; collapsed category `<ul>` carries `aria-label={category.labelAr}` |

#### 4.9 Known limitations (scope boundary)

These reference screens are **static UX baselines using synthetic fixture data**. The approval covers the visual/interaction/ accessibility baseline only. It does **not** prove:

1. **Final transaction logic** — no real inventory posting, approval transaction, or ledger movement is wired. Fixture action buttons are `type="button"` with no submit/mutation.
2. **Production data readiness** — screens render `reference-fixtures-v1` synthetic data, not live Supabase/Postgres query results.
3. **Full business workflow implementation** — the three screens demonstrate layout/density/interaction patterns, not end-to-end workflow (draft → submit → review → approve → post → audit).
4. **Backend permission enforcement on these screens** — role gating (`isWorkerShellRole` / `isManagementShellRole` redirects) is wired, but field-level redaction on live data and backend authorization on real transactions are enforced by WP-01-02 guards, not by these reference screens.
5. **Worker financial redaction on live data** — the worker screen has no financial terms in its fixture/source, but real redaction on live API responses is enforced by DEC-063 and WP-01-02, not by this visual reference.
6. **Chart data source** — dashboard charts render fixture arrays, not live aggregations. Hover/focus interactions are CSS/React state only (no chart library, no tooltips API).

Downstream packages (WP-02-04, WP-03-0x, WP-04-0x, WP-05-0x) must still implement real data wiring, backend authorization, field-level redaction, and transaction logic per their own contracts.

#### 4.10 Visual evidence

Visual evidence for this approval was captured during the validation passes against the deployed Vercel Preview. Screenshots are not committed to the repository (to avoid large binary blobs); instead, the stable evidence references are:

| Evidence | Location |
| --- | --- |
| Approved Preview URL (dashboard) | `https://erp-yarn-git-phase-01-reference-screens-bundle-azzam-s-team.vercel.app/management/dashboard` |
| Approved Preview URL (review queue) | `https://erp-yarn-git-phase-01-reference-screens-bundle-azzam-s-team.vercel.app/management/reviews` |
| Approved Preview URL (worker receipt) | `https://erp-yarn-git-phase-01-reference-screens-bundle-azzam-s-team.vercel.app/worker/raw-receipts/new` |
| Approved commit | `040252ba23e9fa8abb1b1566a60b504183ac11eb` on `main` |
| Validation worklog | `/home/z/my-project/worklog.md` (WP-01-05/06/07 validation entries) |

If a future audit requires committed screenshots, they can be added under `docs/design/evidence/reference-screens/v1/` without changing this approval record's semantic content.

#### 4.11 Per-screen approval summary

##### 4.11.1 Worker raw-material receipt (WP-01-05)

- **Route:** `/worker/raw-receipts/new`
- **Form controls:** 11 (text, select, number, textarea) — all 44×44px touch targets
- **Sections:** 3 grouped Card sections (بيانات الاستلام / الكميات والأوزان / التخزين والملاحظات)
- **Financial terms:** 0 (DEC-063 worker financial redaction verified)
- **Glass/blur:** 0 (DEC-076 Worker Task Mode prohibition verified)
- **Actions:** `type="button"` demo only (حفظ كمسودة / إرسال للمراجعة / إلغاء) — no submit/mutation
- **Owner decision:** Approved 2026-07-01

##### 4.11.2 Accountant review queue (WP-01-06)

- **Route:** `/management/reviews`
- **Summary cards:** 6 count cards (first card brand-highlighted)
- **Queue rows:** 5 rows with severity badges (low/medium/high) + status chips
- **Approval controls:** 10 buttons (5 rows × approve + reject), ALL `disabled: true`, labeled `اعتماد/رفض (غير متاح - شاشة مرجعية)` — no fake approval actions
- **Glass:** Restrained management-surface accent on header (`backdrop-blur-sm` + `from-primary/10` gradient)
- **Owner decision:** Approved 2026-07-01

##### 4.11.3 Owner dashboard (WP-01-07)

- **Route:** `/management/dashboard`
- **KPI cards:** 8 cards, clean `bg-surface`, no corner blobs, no top strips, semantic RTL vertical accents (primary/accent/success/warning/danger), semantic status chips, numbers on solid surface
- **Insight widgets:** 3 (donut composition `توزيع المخزون`, attention ranking `أهم البنود التي تحتاج انتباه`, external factory balances `أرصدة مصانع التشغيل`) — glass-accented management cards
- **Charts:** 5 interactive chart components (donut, attention ranking, factory balances, location bars, review trend, complaints stacked) with Power BI-style hover/focus de-emphasis
- **Glass:** Dashboard header `backdrop-blur-md` + `from-primary/12` gradient; insight cards `backdrop-blur-sm` + `bg-surface/80`; KPI cards NO glass
- **Prohibited KPIs:** 0 internal-factory KPIs (كفاءة الإنتاج / إنتاجية العامل / تشغيل الماكينات / عدد الأوامر النشطة all absent)
- **Owner decision:** Approved 2026-07-01

## 5. Gate result

**WP-01-08 Reference-Screen Approval Gate: PASSED.**

All three reference screens are owner-approved. Broad frontend expansion is now unblocked for packages that declare `WP-01-08` as a dependency, subject to each package's own contract/permission/redaction/test gates.

| Gate criterion (Contract 13 WP-01-08) | Result |
| --- | --- |
| Owner decision evidence recorded | ✅ Approved 2026-07-01 |
| All three screens approved | ✅ Worker receipt, review queue, owner dashboard |
| Screen version/reference documented | ✅ commit `040252b`, branch `phase/01-reference-screens-bundle` |
| Approved palette values documented | ✅ §4.4 |
| Approved typography/density documented | ✅ §4.5 |
| Accepted responsive states documented | ✅ §4.6 |
| Accepted Arabic/RTL behavior documented | ✅ §4.7 |
| Accessibility/reduced-motion documented | ✅ §4.8 |
| Known limitations documented | ✅ §4.9 |
| Decision date recorded | ✅ 2026-07-01 |
| No inferred approval | ✅ Owner explicitly approved after visual review |
| No silent token finalization | ✅ Palette values explicitly approved in §4.4 |
