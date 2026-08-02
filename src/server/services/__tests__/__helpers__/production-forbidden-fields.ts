/**
 * Shared forbidden fields list for production worker actions — WP-08-01B.
 *
 * Exported separately so tests can verify the list without importing
 * a "use server" module.
 */
export const FORBIDDEN_PRODUCTION_FIELDS = [
  "price", "pricePerTon", "cost", "value", "totalCost",
  "payable", "receivable", "account", "settlement",
  "refund", "creditAmount", "creditValue",
  "factoryRate", "factoryRatePerInputTon", "factoryCostBasis",
  "calculatedFactoryCost", "financialTreatment",
  "approvalStatus", "approve", "post", "reverse", "cancel",
  "rateConfirmed", "payableDeferred",
];
