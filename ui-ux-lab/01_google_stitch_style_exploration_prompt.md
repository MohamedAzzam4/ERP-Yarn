# Google Stitch Prompt — Three Visual Directions

Paste the prompt below into [Google Stitch](https://stitch.withgoogle.com). This is the comparison run, not the full-screen run.

---

Create one new web-design project named **ERP Yarn — Visual Direction Study**.

This is an atomic multi-screen generation task. Complete all nine screens in this same uninterrupted run and project. Do not pause for clarification. Do not omit or combine screens.

## Preservation rule

Generate every requested item as a separate new screen/artboard. Once a screen is generated, treat it as immutable. Never edit, regenerate, restyle, rename, or replace an earlier screen while creating a later screen. If you detect an inconsistency, record it in the final report instead of changing an original screen.

## Product content

This is an Arabic-first specialized ERP for yarn trading and outsourced manufacturing. It tracks raw-material batches, external factories as inventory locations, single and twisted yarn production, sales approvals, balances, quality, complaints, returns, and approximate profitability.

This run evaluates UI appearance only. Use static synthetic data. Do not add backend behavior, business logic, authentication behavior, real actions, or server concepts.

## Global anatomy

- Arabic-first RTL web interface.
- Western numerals and dates formatted `DD/MM/YYYY`.
- Keep codes, dates, quantities, and money visually LTR-isolated inside RTL layouts.
- Use a consistent professional SVG icon family; no emoji icons.
- Worker form target: 390×844.
- Accountant and owner targets: 1440×1024.
- Worker form is touch-friendly with 44 px minimum targets.
- Management uses a coherent RTL sidebar, top context bar, clear hierarchy, and desktop data density.
- Use fictional Egyptian Arabic names and clearly synthetic data.
- Place a subtle label: `نموذج واجهة — بيانات تجريبية`.

## Identical content requirement

The anatomy, labels, fixture values, field count, table columns, KPI meanings, and information hierarchy must remain identical across Directions A, B, and C. Change only visual language: palette, typography, spacing feel, borders, depth, radius, and styling details.

## Reference screen content

### Worker raw-material receipt

Arabic title: `استلام خام جديد`

Show only:

- رقم الرسالة `RM-2026-0048`
- المورد `شركة النيل للألياف`
- الصنف `قطن ممشط 30/1`
- الكمية بالكيلو `12,450.000`
- عدد البالات `83`
- مكان الاستلام `مخزن العاشر`
- التاريخ `23/06/2026`
- ملاحظات
- primary button `حفظ المسودة`
- secondary button `إرسال للمراجعة`

Do not show price, cost, supplier balance, accounting, or profitability.

### Accountant approval queue

Arabic title: `مركز المراجعة والاعتماد`

Show tabs/counts for sales, receipts missing prices, production, returns, direct costs, migration warnings, and corrections. Include a filter bar, a readable table, semantic status chips, and one open detail drawer. Use synthetic codes, parties, dates, quantities, and money. The open item must show persistent approve, reject, and request-correction controls as static visual controls.

### Owner dashboard

Arabic title: `لوحة متابعة المالك`

Show no more than six primary KPI cards, then exception/decision sections for total stock, stock held at external factories, pending approvals, customer/factory balances, open complaints, quality risks, approximate profitability, migration status, backup status, and recent important operations. Label profitability `ربحية تقريبية` and prioritize actionable exceptions over decorative charts.

## Direction A — Modern Industrial

Vibe: professional, specialized, confident, industrial, crisp, practical, modern without looking trendy.

- Navy `#0F2747` foundation and teal `#0F766E` accent.
- Amber warning `#D97706` and danger red `#B91C1C`.
- Pale background `#F6F8FB`, white cards, and primary text `#172033`.
- Tajawal-style body/data typography and Alexandria-style headings/actions.
- Restrained shadows, crisp borders, 8–10 px radii, balanced density.

Generate:

1. `A-WORKER-RAW-RECEIPT`
2. `A-ACCOUNTANT-REVIEW-QUEUE`
3. `A-OWNER-DASHBOARD`

## Direction B — Calm Enterprise

Vibe: calm, trustworthy, polished, approachable, spacious, highly legible, premium enterprise.

- Cobalt `#2457C5`, cool slate `#52657A`, and mint `#2A9D8F`.
- Background `#F4F7FB`, white surface, text `#1E293B`, warning `#C47A12`, and danger `#C2414A`.
- Modern Arabic sans typography.
- Softer borders, subtle depth, 10–12 px radii, slightly more whitespace.
- Avoid generic startup gradients and oversized decorative cards.

Generate:

4. `B-WORKER-RAW-RECEIPT`
5. `B-ACCOUNTANT-REVIEW-QUEUE`
6. `B-OWNER-DASHBOARD`

## Direction C — Precision Operational

Vibe: precise, rational, fast-scanning, disciplined, operational, quietly distinctive.

- Ink `#20252B` foundation and safety amber `#D48A17`.
- Warm background `#F3F0E8`, surface `#FFFEFA`, and text `#171A1D`.
- Semantic success `#2F7D57` and danger `#B23A3A` only when meaningful.
- Strong modern Arabic typography.
- Strict grid, sharp hierarchy, minimal decoration, 4–6 px radii, compact readable management density.
- Worker screen remains spacious and touch-friendly.

Generate:

7. `C-WORKER-RAW-RECEIPT`
8. `C-ACCOUNTANT-REVIEW-QUEUE`
9. `C-OWNER-DASHBOARD`

## Final output

After generating all nine immutable screens, output a manifest with exactly these nine IDs and mark each `generated`. Report any limitation or inconsistency. Do not modify any screen while producing the manifest.

---
