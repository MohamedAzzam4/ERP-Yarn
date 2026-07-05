/**
 * WP-02-04 Worker redaction proof — scan the worker receipt form for
 * forbidden financial fields.
 *
 * Contract 11 §17: "Forbidden worker financial fields are rejected, not
 * silently accepted."
 * Contract 10 §7.1: Worker can create/update own draft, save, submit.
 *   Forbidden: approve/post/reverse, financial treatment.
 *
 * This test renders the WorkerReceiptForm to a string and asserts that
 * NO financial field names appear in the rendered HTML — neither as
 * input names, IDs, labels, nor hidden fields.
 *
 * The forbidden field list covers both English keys (used in form names
 * and IDs) and Arabic labels (used in visible text).
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkerReceiptForm } from "@/components/reference-screens/worker-receipt-form";
import * as React from "react";

// English field names that MUST NOT appear in the worker form.
const FORBIDDEN_ENGLISH_KEYS = [
  "purchase_price_per_ton",
  "purchasePricePerTon",
  "total_purchase_cost",
  "totalPurchaseCost",
  "payable",
  "payable_amount",
  "payableAmount",
  "account_entry",
  "accountEntryId",
  "balance",
  "on_hand_qty",
  "profit",
  "cost",
  "price",
  "movement_id",
  "movementId",
  "doc_no",
  "docNo",
];

// Arabic labels that MUST NOT appear in the worker form as FIELD LABELS.
// Note: disclaimer text like "لا يتم ترحيل المخزون أو إنشاء قيود مالية"
// (no stock posting or financial entries) is ALLOWED — it tells the worker
// that no financial effect happens. We only forbid labels that would
// indicate a financial INPUT field exists.
const FORBIDDEN_ARABIC_KEYS = [
  "سعر",
  "تكلفة",
  "مستحق",
  "رصيد",
  "ربح",
];

describe("WP-02-04 worker redaction — form HTML scan", () => {
  it("worker form renders with no financial fields (English keys)", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkerReceiptForm, { suppliers: [], locations: [], fiberTypes: [], dbAvailable: false }),
    );
    for (const key of FORBIDDEN_ENGLISH_KEYS) {
      const regex = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      expect(html).not.toMatch(regex);
    }
  });

  it("worker form renders with no financial labels (Arabic)", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkerReceiptForm, { suppliers: [], locations: [], fiberTypes: [], dbAvailable: false }),
    );
    for (const key of FORBIDDEN_ARABIC_KEYS) {
      expect(html).not.toContain(key);
    }
  });

  it("worker form does not submit financial field names even with master data present", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkerReceiptForm, {
        suppliers: [{ id: "s1", nameAr: "مورد ١", code: "S001" }],
        locations: [{ id: "l1", nameAr: "مخزن ١", code: "L001" }],
        fiberTypes: [{ id: "f1", nameAr: "قطن", code: "COT" }],
        dbAvailable: true,
      }),
    );
    for (const key of FORBIDDEN_ENGLISH_KEYS) {
      const regex = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      expect(html).not.toMatch(regex);
    }
  });

  it("worker form has 11-12 visible form fields (operational facts only)", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkerReceiptForm, { suppliers: [], locations: [], fiberTypes: [], dbAvailable: false }),
    );
    const visibleFieldMatches = html.match(/<(?:input|select|textarea)\b[^>]*name="([^"]+)"/g) || [];
    const names = visibleFieldMatches
      .map((m) => m.match(/name="([^"]+)"/)?.[1])
      .filter((n): n is string => !!n && n !== "submit_action");
    // 11 (contract baseline) or 12 (origin_country split from raw_grade,
    // justified by schema having origin_country as a real column).
    expect(names.length).toBeGreaterThanOrEqual(11);
    expect(names.length).toBeLessThanOrEqual(12);
  });

  it("worker form has 3 grouped Card sections", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkerReceiptForm, { suppliers: [], locations: [], fiberTypes: [], dbAvailable: false }),
    );
    // CardTitle renders as <h3> (per our Card component).
    // Count distinct section headers.
    const sectionTitles = [
      "بيانات الاستلام",
      "الكميات والأوزان",
      "التخزين والملاحظات",
    ];
    for (const title of sectionTitles) {
      expect(html).toContain(title);
    }
  });

  it("worker form inputs meet 44px touch target (min-h-[44px])", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkerReceiptForm, { suppliers: [], locations: [], fiberTypes: [], dbAvailable: false }),
    );
    const fields = html.match(/<(?:input|select|textarea)\b[^>]*class="([^"]*)"/g) || [];
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      const cls = field.match(/class="([^"]*)"/)?.[1] ?? "";
      expect(cls).toContain("min-h-[44px]");
    }
  });

  it("worker form uses LTR isolation for codes/dates/quantities", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkerReceiptForm, { suppliers: [], locations: [], fiberTypes: [], dbAvailable: false }),
    );
    const ltrFields = html.match(/dir="ltr"/g) || [];
    expect(ltrFields.length).toBeGreaterThanOrEqual(5);
  });

  it("worker form has accessible labels (htmlFor) for all fields", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkerReceiptForm, { suppliers: [], locations: [], fiberTypes: [], dbAvailable: false }),
    );
    const labels = html.match(/<label[^>]*for="([^"]+)"/g) || [];
    const inputs = html.match(/<(?:input|select|textarea)[^>]*id="([^"]+)"/g) || [];
    expect(labels.length).toBe(inputs.length);
  });
});
