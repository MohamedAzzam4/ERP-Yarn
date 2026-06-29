# Reference Screen Terminology and Fixtures v1

## 1. Status and Purpose

This document is the canonical owner-approved/provisional fixture for the three Phase 1 reference screens:

1. Worker raw-material receipt.
2. Accountant review queue.
3. Owner dashboard.

It resolves:

- `PCD-UX-001` by defining the provisional Arabic terminology fixture.
- `PCD-UX-004` by defining canonical synthetic and prohibited-data fixture versions for the three reference screens.

It does not approve the finished screen designs. Visual approval is recorded separately through `docs/design/reference_screen_approval.md`.

No real client data is used here. All names, quantities, amounts, dates and document numbers are synthetic.

## 2. Source Priority for Arabic Terms

Arabic terminology source priority:

1. Client Excel/screenshots when provided by the owner.
2. This provisional terminology fixture.
3. Contracted domain terms already present in repository docs.

If a required Arabic term is missing from the client Excel/screenshots and this fixture, coding agents must not invent a new business label. They must use:

> Unresolved / requires owner decision

Minor UI-only verbs already listed here may be reused for buttons, empty states and navigation.

## 2.1 Client Excel Source Reviewed

Owner-provided workbook reviewed:

```text
متابعة انتاج وبيع خيوط الغزل (3).xlsx
```

Workbook sheets used as terminology source:

- `مخطط العمل`
- `خام`
- `مبيعات خامات`
- `انتاج الفرد وتوزيعه`
- `انتاج الزوى وتوزيعه`
- `حركة المخازن`
- `شكاوى العملاء`
- `جودة الخيوط`
- `جودة الخامات`
- `ورقة1`

The workbook is treated as the current client vocabulary source, not as a final data model. Obvious spreadsheet typos may be normalized in UI labels while preserving the business term. Example: workbook text `مصتع انتاج الخيط الفرد` is normalized to `مصنع انتاج الخيط الفرد`.

## 3. Provisional Arabic Terminology v1

### 3.1 Shared UI Terms

| English meaning | Arabic UI term |
| --- | --- |
| Dashboard | لوحة التحكم |
| Review Center | مركز المراجعات |
| Required reviews | مراجعات مطلوبة |
| Important warnings | تحذيرات مهمة |
| Notifications | الإشعارات |
| Quick search | بحث سريع |
| Manual refresh | تحديث |
| Last refreshed | آخر تحديث |
| My recent activity | آخر نشاطاتي |
| Details | التفاصيل |
| Open details | عرض التفاصيل |
| Close | إغلاق |
| Save draft | حفظ كمسودة |
| Submit for review | إرسال للمراجعة |
| Notes | ملاحظات |
| Status | الحالة |
| Date | التاريخ |
| Quantity | الكمية |
| Kilogram | كجم |
| Ton | طن |
| Loading | جار التحميل |
| Empty state | لا توجد بيانات |
| Permission denied | غير مصرح |
| Error | حدث خطأ |
| Retry | إعادة المحاولة |

### 3.2 Roles

| Role code | Arabic UI term |
| --- | --- |
| Owner | المالك |
| Accountant | المحاسب |
| Warehouse Worker | عامل المخزن |
| Production Worker | عامل الإنتاج |
| Quality | مسؤول الجودة |

### 3.3 Domain Terms

| English/domain meaning | Arabic UI term |
| --- | --- |
| Raw material receipt | استلام خام |
| New raw receipt | استلام خام جديد |
| Raw material | خام |
| Raw batch | دفعة خام |
| Batch code | كود الدفعة |
| Lot code | كود اللوط |
| Document number | رقم المستند |
| Supplier | المورد |
| Customer | العميل |
| External factory | مصنع خارجي |
| Warehouse | مخزن |
| Inventory location | موقع مخزون |
| Stock balance | رصيد المخزون |
| Available stock | مخزون متاح |
| Reserved stock | مخزون محجوز |
| Stock at external factories | مخزون لدى المصانع الخارجية |
| Outsourced production | تشغيل خارجي |
| Production order | أمر تشغيل |
| Work in progress | تحت التشغيل |
| Single yarn | غزل مفرد |
| Twisted yarn | غزل مزوي |
| Waste | هالك |
| Returned material | مرتجع |
| Complaint | شكوى |
| Quality test | اختبار جودة |
| Needs review | يحتاج مراجعة |
| Draft | مسودة |
| Submitted | مرسل للمراجعة |
| Approved | معتمد |
| Rejected | مرفوض |
| Blocked | محظور |
| Sellable | قابل للبيع |
| Receipt missing price | استلام خام بدون سعر |
| Cost review | مراجعة تكلفة |
| Direct cost | تكلفة مباشرة |
| Party balances | أرصدة الأطراف |
| Factory payable | مستحقات مصنع |
| Approximate profitability | ربحية تقريبية |

### 3.3.1 Client Excel Terms to Prefer

Use these workbook-derived labels where they fit the screen context:

| Workbook context | Preferred Arabic UI term |
| --- | --- |
| Raw materials sheet/module | الخامات |
| Raw receipt date | تاريخ استلام الخامات |
| Raw type | نوع الخام |
| Raw class/origin/category | صنف الخام |
| Raw supplier | مورد الخام |
| Raw message/batch reference | رسالة الخام |
| Season | موسم |
| Bale count | عدد بال الرسالة |
| Gross/standing message weight | وزن قائم الرسالة |
| Storage place | مكان التخزين |
| Ton price | سعر الطن |
| Total raw purchase value | اجمالى الثمن |
| Purchase operation number | رقم عملية الشراء |
| Raw sale date | تاريخ بيع الخامات |
| Order nature | طبيعة الطلبية |
| Raw source | مصدر الخام |
| Sold bale count | عدد بال مباع |
| Weight in kg | وزن كجم |
| Raw sale value | اجمالى ثمن البيع |
| Buying customer | العميل المشترى |
| Raw sale operation number | رقم عملية بيع الخام |
| Purpose of raw sale | الغرض من بيع الخام |
| Warehouse balance | رصيد مخزن |
| Single-yarn production tracking | انتاج الفرد وتوزيعه |
| Twisted-yarn production tracking | انتاج الزوى وتوزيعه |
| Single-yarn producer | الشركة المنتجة للخيط الفرد |
| Twisting factory | مصنع الزوى |
| Single-yarn lot | لوط الفرد |
| Yarn count/spec | خيط |
| Single-yarn twist coefficient | م برم الفرد |
| Single-yarn balance at producer before transfer | رصيد فرد بالشركة قبل النقل |
| Sold single yarn kg | مباع كجم |
| Transfer single yarn to twisting kg | نقل فرد للزوى كجم |
| Transfer to warehouse kg | نقل مخزن كجم |
| Remaining balance at producer | رصيد باقى بالشركة |
| Consumed raw material | الخام المستهلك |
| Factory processing price per ton | سعر تشغيل الطن |
| Processing value | ثمن التشغيل |
| Twisted yarn quantity kg | كمية الخيط المزوى كجم |
| Twisted yarn count | نمرة الخيط المزوى |
| Twisting turns per meter | برمات المتر للزوى |
| Twisted-yarn twist coefficient | معامل برم المزوى |
| Sold twisted yarn kg | مباع مزوى كجم |
| Buying customer for twisted yarn | عميل مشترى مزوى |
| Transfer twisted yarn to warehouse kg | نقل مزوى مخزن كجم |
| Warehouse/store | المخزن |
| Customer complaints | شكاوى العملاء |
| Customer complaint date | تاريخ شكوى العميل |
| Textile customer | عميل النسيج |
| Yarn | خيط |
| Lot | لوط |
| Cotton message | رسالة قطن |
| Complaint rejection reason | الشكوى سبب الرفض |
| Complaint verification/resolution | التحقق من الشكوى وحل المشكلة |
| Re-test yarn | اعادة تحليل الخيط |
| Yarn quality | جودة الخيوط |
| Raw material technical specs | مواصفات الخامات الفنية |
| Raw quality | جودة الخامات |
| Yarn achieved level | المستوى المحقق |
| Results of achieved level | نتائج المستوى المحقق |
| Higher-level results | نتائج المستوى الاعلى |
| Lower-level results | نتائج المستوى الادنى |
| Yarn count | نمرة الخيط الفرد |
| Required turns per meter | البرمات المطلوبة للمتر |
| Required turns per inch | البرمات المطلوبة للبوصة |
| Twist factor | معامل البرم |
| Yarn type | نوع الخيط |
| Yarn preparation | تجهيز الخيط |
| Cotton message | رسالة القطن |
| Agreed waste percentage | نسبة العادم المتفق عليها |
| Received lot | اللوط المستلم |
| Received lot transfer destination | جهة نقل اللوط المستلم |
| Analysis date | تاريخ تحليل الخيط |
| Analysis place | مكان التحليل |
| Analysis party | جهة التحليل |
| Main interface | الواجهة الاساسية |
| Purchases | المشتريات |
| Suppliers and customers | الموردين والعملاء |
| Costs and profits | التكاليف والارباح |
| Sales | المبيعات |
| Customers | العملاء |
| Yarn production | انتاج الخيوط |
| Warehouses and inventory | المخازن والمخزون |
| Data request/search | طلب بيان معين |
| Charts/data visualizations | التوضيحات البيانية للارقام |

### 3.4 Worker-Prohibited Financial Terms

Worker Task Mode must not display these terms or their underlying values:

```text
سعر
تكلفة
رصيد مورد
رصيد عميل
رصيد مصنع
مستحقات
مدفوعات
تسويات
حسابات
قيد محاسبي
ربحية
هامش ربح
صافي الربح
```

If a Worker-facing fixture accidentally contains any of these terms or equivalent financial data, the reference screen fails.

## 4. Canonical Fixture Version

Fixture version: `reference-fixtures-v1`

Global fixture assumptions:

- Tenant: `tenant-demo-yarn`.
- Display date format: `DD/MM/YYYY`.
- Tenant timezone: `Africa/Cairo`.
- Numerals: Western numerals.
- Currency display where allowed: `جنيه`.
- All document, batch, lot and code values are isolated LTR in UI.

Users:

| User | Role | Arabic display name |
| --- | --- | --- |
| owner.demo@example.com | Owner | مالك النظام |
| accountant.demo@example.com | Accountant | محاسب المراجعة |
| warehouse.demo@example.com | Warehouse Worker | عامل مخزن 1 |
| production.demo@example.com | Production Worker | عامل إنتاج 1 |
| quality.demo@example.com | Quality | مسؤول جودة 1 |

Locations:

| Code | Arabic name | Type |
| --- | --- | --- |
| WH-ALX-31 | 31اسكندرية | Warehouse |
| WH-MISR-01 | مخزن مصر ايران | Warehouse |
| FAC-SPIN-01 | مصر ايران | External factory |
| FAC-TWIST-01 | زوى عبدالحميد | External factory |
| FAC-TWIST-02 | زوى ابوقمر | External factory |

Parties:

| Code | Arabic name | Type |
| --- | --- | --- |
| SUP-001 | عثمان | Supplier |
| SUP-002 | كارجيل | Supplier |
| CUS-001 | عميل النسيج | Customer |
| FAC-001 | مصر ايران | Factory |
| FAC-002 | زوى عبدالحميد | Factory |

## 5. Worker Raw-Material Receipt Reference Fixture

Screen route placeholder: `/worker/raw-receipts/new`

Screen title:

```text
استلام خام جديد
```

Visible fields:

| Field | Fixture value |
| --- | --- |
| رقم عملية الشراء | PR-2026-0007 |
| تاريخ استلام الخامات | 20/06/2026 |
| نوع الخام | قطن سودانى |
| صنف الخام | السودان |
| مورد الخام | عثمان |
| رسالة الخام | 1002 |
| موسم | 2024/2025 |
| عدد بال الرسالة | 25 |
| وزن قائم الرسالة | 1,250.000 كجم |
| مكان التخزين | 31اسكندرية |
| ملاحظات | تم الاستلام ظاهرياً، يحتاج مراجعة الجودة |

Allowed visible actions:

- حفظ كمسودة
- إرسال للمراجعة
- إضافة ملاحظة
- اختيار "غير موجود في القائمة" for supplier/material/location details, routed to review.

Expected screen states:

| State | Expected UI behavior |
| --- | --- |
| Initial | Empty form with safe default date and clear labels. |
| Draft saved | Status chip `مسودة`; row/activity highlight. |
| Submitted | Status chip `مرسل للمراجعة`; no stock posting claim. |
| Missing option | Temporary text captured and routed for review; official master data is not created. |
| Permission denied | Arabic denial without financial detail. |

Expected totals:

```text
net_entered_quantity_kg = 1,250.000
bales_count = 25
stock_posted = false
financial_fields_visible = false
```

Prohibited worker data:

- purchase price;
- payable amount;
- supplier balance;
- accounting entry;
- profitability;
- direct cost allocation;
- settlement/payment state;
- approval success or posting confirmation.

## 6. Accountant Review-Queue Reference Fixture

Screen route placeholder: `/management/reviews`

Screen title:

```text
مركز المراجعات
```

Summary counts:

| Category | Count |
| --- | ---: |
| كل المراجعات المطلوبة | 8 |
| استلام خام بدون سعر | 3 |
| مراجعة تكلفة تشغيل | 2 |
| مراجعة تحويل مخزون | 1 |
| تكلفة مباشرة | 1 |
| تحذير ترحيل تاريخي | 1 |

Queue rows:

| Document | Arabic type | Submitted by | Date | Severity | State |
| --- | --- | --- | --- | --- | --- |
| RR-2026-0007 | استلام خام بدون سعر | عامل مخزن 1 | 20/06/2026 | medium | يحتاج مراجعة |
| PR-2026-0003 | مراجعة تكلفة تشغيل | عامل إنتاج 1 | 19/06/2026 | high | يحتاج مراجعة |
| TR-2026-0004 | مراجعة تحويل مخزون | عامل مخزن 1 | 19/06/2026 | medium | يحتاج مراجعة |
| DC-2026-0002 | تكلفة مباشرة | محاسب المراجعة | 18/06/2026 | low | مسودة مراجعة |
| MIG-2026-OPEN | تحذير ترحيل تاريخي | مالك النظام | 18/06/2026 | high | يحتاج مراجعة |

Reference-screen action behavior:

- Detail drawer may open.
- Approve/reject buttons are visual placeholders unless the real command package exists.
- Placeholder actions must be disabled/read-only and labeled as non-operational.
- No toast may imply a real status change.

Expected permission behavior:

- Accountant can see financial review categories allowed by the permission matrix.
- Worker cannot access this screen or its data.
- Owner can access this screen.

## 7. Owner Dashboard Reference Fixture

Screen route placeholder: `/management/dashboard`

Screen title:

```text
لوحة التحكم
```

KPI cards:

| Card | Value | Click target |
| --- | ---: | --- |
| إجمالي المخزون | 18,450.000 كجم | Inventory balances |
| مخزون لدى مصانع التشغيل | 6,200.000 كجم | Inventory balances filtered to external factories |
| مبيعات الشهر الحالي | 320,000.00 جنيه | Sales list filtered to current month |
| مراجعات مطلوبة | 8 | Review Center |
| تحذيرات مهمة | 3 | Warning-filtered Review Center |
| شكاوى مفتوحة | 2 | Quality and complaints |
| ربحية تقريبية | 48,750.00 جنيه | Profitability summary |
| مستحقات مصانع | 92,000.00 جنيه | Factory statements |

Charts:

| Chart | Required data points |
| --- | --- |
| المخزون حسب الموقع | 31اسكندرية 12,250.000 كجم; مخزن مصر ايران 3,800.000 كجم; زوى عبدالحميد 2,400.000 كجم |
| اتجاه المراجعات | 16/06 = 4; 17/06 = 6; 18/06 = 5; 19/06 = 7; 20/06 = 8 |
| الشكاوى حسب الحالة | مفتوحة = 2; قيد التحقيق = 1; مغلقة = 5 |

Recent activity strips:

| Activity | Summary | Details behavior |
| --- | --- | --- |
| RR-2026-0007 | استلام خام مرسل للمراجعة | Multi-open expandable strip |
| PR-2026-0003 | استلام إنتاج يحتاج مراجعة تكلفة | Multi-open expandable strip |
| SALE-2026-0012 | بيع معتمد خلال الشهر الحالي | Multi-open expandable strip |

Dashboard constraints:

- KPI cards are navigational.
- Dashboard is not the Review Center.
- It must not show internal factory-floor metrics such as machine utilization, shift efficiency, worker productivity, production-line efficiency or unlabeled production efficiency.
- Use outsourced-manufacturing wording: external-factory stock, open outsourced-production orders, issued raw material, received yarn, waste/returned material, factory payables and review warnings.
- Approximate profitability must be labeled as approximate and must show missing-cost flags if data is incomplete.

## 8. Prohibited-Data Fixture Checks

The reference-screen tests must include negative assertions:

### Worker raw receipt

Must not render:

```text
سعر
تكلفة
رصيد
مستحقات
مدفوعات
ربحية
قيد محاسبي
```

Must not include hidden payload fields for price, payable, balance, accounting entry or profitability.

### Accountant review queue

Must not render worker-only task controls as approval shortcuts. Must not show disabled placeholder actions as successful operational commands.

### Owner dashboard

Must not render generic internal-factory KPIs:

```text
كفاءة الإنتاج
إنتاجية العامل
تشغيل الماكينات
عدد الأوامر النشطة
```

Use outsourced-manufacturing labels instead.

## 9. Change Policy

This fixture is versioned. If the owner later provides Excel screenshots/labels or changes the preferred terms/data, create a new version such as `reference-fixtures-v2`. Do not overwrite evidence for prior approved versions.
