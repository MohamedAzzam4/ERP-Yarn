/**
 * Test fixtures for the 5 MVP roles + inactive/unmapped/cross-tenant cases.
 *
 * Contract: docs/contracts/11_permission_matrix.md §5 (Roles)
 * Contract: docs/contracts/12_testing_and_regression_plan.md §7
 *   "authenticate each role and inactive/foreign-tenant users"
 *
 * These fixtures provide stable, synthetic identities for tests. They are
 * NOT production seeds — they must NEVER be inserted into a real database.
 *
 * Each fixture includes:
 *   - A stable UUID for the user, tenant, and role assignment.
 *   - The role code(s) assigned to the user.
 *   - The expected ErpUserContext shape (for guard tests).
 *   - The expected EffectivePermissions shape (for redaction tests).
 *
 * WP-01-02 scope: pure data + helper builders. No I/O, no DB.
 */
import type { ErpUserContext } from "@/server/auth/erp-context";
import type { RoleCode } from "./role-codes";
import type { RolePermissionMatrix } from "./effective-permissions";
import {
  resolveEffectivePermissions,
  type EffectivePermissions,
} from "./effective-permissions";
import {
  SEED_TENANT,
  SEED_ROLES,
  SEED_PERMISSIONS,
  SEED_ROLE_PERMISSIONS,
} from "@/server/db/seed/platform-security";

// ---------------------------------------------------------------------------
// 1. Tenant fixtures.
// ---------------------------------------------------------------------------

/**
 * Primary test tenant (matches the seed tenant).
 */
export const TEST_TENANT_ID = SEED_TENANT.id;

/**
 * Foreign tenant ID for cross-tenant tests. Distinct from TEST_TENANT_ID
 * so any accidental match would fail loudly.
 */
export const FOREIGN_TENANT_ID =
  "00000000-0000-0000-0000-ffffffffffff" as const;

// ---------------------------------------------------------------------------
// 2. User fixtures (5 MVP roles).
// ---------------------------------------------------------------------------

/**
 * Stable UUIDs for the 5 MVP role test users.
 *
 * Pattern: 00000000-0000-0000-0000-0000000X0YYY where X is the role index
 * (1=owner, 2=accountant, 3=warehouse, 4=production, 5=quality) and YYY
 * is a sequence.
 */
export const TEST_USER_IDS = {
  owner: "00000000-0000-0000-0000-000000000101",
  accountant: "00000000-0000-0000-0000-000000000201",
  warehouse: "00000000-0000-0000-0000-000000000301",
  production: "00000000-0000-0000-0000-000000000401",
  quality: "00000000-0000-0000-0000-000000000501",
  // Cross-tenant user (same role, different tenant)
  foreignAccountant: "00000000-0000-0000-0000-000000000202",
  // Inactive user (Owner role but status=inactive)
  inactiveOwner: "00000000-0000-0000-0000-000000000102",
  // Multi-role user (Owner + Warehouse — tests DEC-063 ceiling)
  multiRoleOwnerWarehouse: "00000000-0000-0000-0000-000000000103",
  // Unmapped user (Supabase Auth identity exists but no ERP user row)
  unmapped: "00000000-0000-0000-0000-000000000999",
} as const;

/**
 * Build an ErpUserContext for a test user.
 */
export function buildErpUserContext(params: {
  userId: string;
  tenantId?: string;
  email: string;
  name: string;
  authId: string;
}): ErpUserContext {
  return {
    authenticated: true,
    userId: params.userId,
    tenantId: params.tenantId ?? TEST_TENANT_ID,
    email: params.email,
    name: params.name,
    authId: params.authId,
  };
}

/**
 * The 5 MVP role test users, each with a single active role.
 */
export const TEST_USERS = {
  owner: buildErpUserContext({
    userId: TEST_USER_IDS.owner,
    email: "test-owner@erp-yarn.local",
    name: "Test Owner",
    authId: "PLACEHOLDER_TEST_OWNER_AUTH",
  }),

  accountant: buildErpUserContext({
    userId: TEST_USER_IDS.accountant,
    email: "test-accountant@erp-yarn.local",
    name: "Test Accountant",
    authId: "PLACEHOLDER_TEST_ACCOUNTANT_AUTH",
  }),

  warehouse: buildErpUserContext({
    userId: TEST_USER_IDS.warehouse,
    email: "test-warehouse@erp-yarn.local",
    name: "Test Warehouse Worker",
    authId: "PLACEHOLDER_TEST_WAREHOUSE_AUTH",
  }),

  production: buildErpUserContext({
    userId: TEST_USER_IDS.production,
    email: "test-production@erp-yarn.local",
    name: "Test Production Worker",
    authId: "PLACEHOLDER_TEST_PRODUCTION_AUTH",
  }),

  quality: buildErpUserContext({
    userId: TEST_USER_IDS.quality,
    email: "test-quality@erp-yarn.local",
    name: "Test Quality Worker",
    authId: "PLACEHOLDER_TEST_QUALITY_AUTH",
  }),
} as const;

/**
 * Cross-tenant Accountant user — same role, different tenant.
 * Used to verify cross-tenant entity access is denied.
 */
export const TEST_FOREIGN_ACCOUNTANT = buildErpUserContext({
  userId: TEST_USER_IDS.foreignAccountant,
  tenantId: FOREIGN_TENANT_ID,
  email: "test-foreign-accountant@erp-yarn.local",
  name: "Test Foreign Accountant",
  authId: "PLACEHOLDER_TEST_FOREIGN_ACCOUNTANT_AUTH",
});

/**
 * Inactive Owner user — has the Owner role but status=inactive.
 * The ErpUserContext for an inactive user would NOT be returned by
 * getErpAuthContext (it returns a denial instead), so this fixture is
 * for testing the guard's denial path.
 */
export const TEST_INACTIVE_OWNER_DENIAL = {
  authenticated: false as const,
  reason: "inactive" as const,
};

/**
 * Unmapped user denial — Supabase Auth identity exists but no ERP user.
 */
export const TEST_UNMAPPED_USER_DENIAL = {
  authenticated: false as const,
  reason: "unmapped" as const,
};

/**
 * No-session denial — no Supabase Auth session.
 */
export const TEST_NO_SESSION_DENIAL = {
  authenticated: false as const,
  reason: "no_session" as const,
};

// ---------------------------------------------------------------------------
// 3. Role-assignment fixtures.
// ---------------------------------------------------------------------------

/**
 * The role assignments for each test user.
 *
 * MVP: one active operational role per user (DEC-061). The multi-role
 * fixture is an exceptional case for testing the DEC-063 ceiling.
 */
export const TEST_ROLE_ASSIGNMENTS: Record<string, ReadonlyArray<RoleCode>> = {
  [TEST_USER_IDS.owner]: ["owner"],
  [TEST_USER_IDS.accountant]: ["accountant"],
  [TEST_USER_IDS.warehouse]: ["warehouse_employee"],
  [TEST_USER_IDS.production]: ["production_employee"],
  [TEST_USER_IDS.quality]: ["quality_employee"],
  [TEST_USER_IDS.foreignAccountant]: ["accountant"],
  // Multi-role: Owner + Warehouse. DEC-063 ceiling should strip
  // financial permissions even though Owner grants them.
  [TEST_USER_IDS.multiRoleOwnerWarehouse]: ["owner", "warehouse_employee"],
};

/**
 * Get the role assignments for a test user.
 */
export function getTestRoleAssignments(userId: string): ReadonlyArray<RoleCode> {
  const roles = TEST_ROLE_ASSIGNMENTS[userId];
  if (!roles) {
    throw new Error(
      `No test role assignments for user '${userId}'. Known: ${Object.keys(TEST_ROLE_ASSIGNMENTS).join(", ")}.`,
    );
  }
  return roles;
}

// ---------------------------------------------------------------------------
// 4. Effective-permissions fixtures.
// ---------------------------------------------------------------------------

/**
 * Reconstruct the role-permission matrix from the exported seed data.
 *
 * The seed file's `ROLE_PERMISSION_MATRIX` is module-private, so we
 * rebuild the equivalent mapping from the exported `SEED_ROLES`,
 * `SEED_PERMISSIONS`, and `SEED_ROLE_PERMISSIONS`. This avoids modifying
 * the seed file (which is WP-00-03A scope) while giving us the same
 * role→permission-key set mapping for test fixtures.
 *
 * The reconstruction is verified to match the seed's defense-in-depth
 * invariant: Worker roles (warehouse/production/quality) receive NO
 * financial permission keys.
 */
function buildTestRolePermissionMatrix(): RolePermissionMatrix {
  const roleByCode = SEED_ROLES.reduce(
    (acc, r) => {
      acc[r.roleCode] = r.id;
      return acc;
    },
    {} as Record<RoleCode, string>,
  );
  const permissionById = SEED_PERMISSIONS.reduce(
    (acc, p) => {
      acc[p.id] = p.permissionKey;
      return acc;
    },
    {} as Record<string, string>,
  );

  const matrix: Record<RoleCode, Set<string>> = {
    owner: new Set(),
    accountant: new Set(),
    warehouse_employee: new Set(),
    production_employee: new Set(),
    quality_employee: new Set(),
  };

  for (const rp of SEED_ROLE_PERMISSIONS) {
    const roleCode = SEED_ROLES.find((r) => r.id === rp.roleId)?.roleCode;
    const permKey = permissionById[rp.permissionId];
    if (!roleCode || !permKey) continue;
    matrix[roleCode].add(permKey);
  }

  return matrix;
}

/**
 * The role-permission matrix reconstructed from the seed data. Provides a
 * single import point for tests.
 */
export const TEST_ROLE_PERMISSION_MATRIX: RolePermissionMatrix =
  buildTestRolePermissionMatrix();

/**
 * Resolve effective permissions for a test user.
 *
 * Caches the resolution per userId so repeated calls in a test suite are
 * fast and consistent.
 */
const effectivePermissionsCache = new Map<string, EffectivePermissions>();

export function getTestEffectivePermissions(
  userId: string,
): EffectivePermissions {
  const cached = effectivePermissionsCache.get(userId);
  if (cached) return cached;

  const roles = getTestRoleAssignments(userId);
  const effective = resolveEffectivePermissions(
    roles,
    TEST_ROLE_PERMISSION_MATRIX,
  );
  effectivePermissionsCache.set(userId, effective);
  return effective;
}

/**
 * The 5 MVP role users as a list, for parameterized tests.
 */
export const ALL_MVP_ROLE_USERS = [
  { label: "owner", user: TEST_USERS.owner, roles: ["owner"] as RoleCode[] },
  { label: "accountant", user: TEST_USERS.accountant, roles: ["accountant"] as RoleCode[] },
  { label: "warehouse", user: TEST_USERS.warehouse, roles: ["warehouse_employee"] as RoleCode[] },
  { label: "production", user: TEST_USERS.production, roles: ["production_employee"] as RoleCode[] },
  { label: "quality", user: TEST_USERS.quality, roles: ["quality_employee"] as RoleCode[] },
] as const;

// ---------------------------------------------------------------------------
// 5. Multi-role conflict fixture (DEC-061 + DEC-063).
// ---------------------------------------------------------------------------

/**
 * Multi-role test user: Owner + Warehouse.
 *
 * DEC-061: effective permissions are the union of Owner + Warehouse.
 * DEC-063: Worker financial-deny ceiling strips financial permissions
 * even though Owner grants them.
 *
 * Expected: this user has Owner's operational permissions PLUS
 * Warehouse's operational permissions, but Owner's financial permissions
 * (sales.view_price, balances.view_customer, etc.) are STRIPPED.
 */
export const TEST_MULTI_ROLE_USER = buildErpUserContext({
  userId: TEST_USER_IDS.multiRoleOwnerWarehouse,
  email: "test-multi-role@erp-yarn.local",
  name: "Test Multi-Role (Owner + Warehouse)",
  authId: "PLACEHOLDER_TEST_MULTI_ROLE_AUTH",
});

// ---------------------------------------------------------------------------
// 6. Worker scope-assignment fixtures (DEC-062).
// ---------------------------------------------------------------------------

import type { WorkerScopeAssignment } from "./worker-scope";

/**
 * Test scope assignments for the Warehouse worker.
 *
 * Assigned to:
 *   - location: TEST_LOCATION_A
 *   - external_factory: TEST_FACTORY_A
 *   - task_type: "raw_receipt"
 *
 * NOT assigned to:
 *   - location: TEST_LOCATION_B (should be denied)
 *   - external_factory: TEST_FACTORY_B (should be denied)
 */
export const TEST_LOCATION_A = "00000000-0000-0000-0001-000000000001";
export const TEST_LOCATION_B = "00000000-0000-0000-0001-000000000002";
export const TEST_FACTORY_A = "00000000-0000-0000-0002-000000000001";
export const TEST_FACTORY_B = "00000000-0000-0000-0002-000000000002";
export const TEST_TASK_TYPE_RAW_RECEIPT = "raw_receipt";
export const TEST_TASK_TYPE_QUALITY_REVIEW = "quality_review";

export const TEST_WAREHOUSE_SCOPE_ASSIGNMENTS: ReadonlyArray<WorkerScopeAssignment> = [
  {
    tenantId: TEST_TENANT_ID,
    userId: TEST_USER_IDS.warehouse,
    scopeType: "location",
    targetIdentifier: TEST_LOCATION_A,
    isActive: true,
  },
  {
    tenantId: TEST_TENANT_ID,
    userId: TEST_USER_IDS.warehouse,
    scopeType: "external_factory",
    targetIdentifier: TEST_FACTORY_A,
    isActive: true,
  },
  {
    tenantId: TEST_TENANT_ID,
    userId: TEST_USER_IDS.warehouse,
    scopeType: "task_type",
    targetIdentifier: TEST_TASK_TYPE_RAW_RECEIPT,
    isActive: true,
  },
];

/**
 * Empty scope assignments — for testing default-deny behavior.
 */
export const TEST_EMPTY_SCOPE_ASSIGNMENTS: ReadonlyArray<WorkerScopeAssignment> = [];

// ---------------------------------------------------------------------------
// 7. Sample DTO fixtures (for redaction tests).
// ---------------------------------------------------------------------------

/**
 * A sample raw-receipt DTO with both operational and financial fields.
 *
 * Operational fields (visible to Workers): id, batch_number, location_id,
 * received_qty_kg, quality_status, received_at.
 *
 * Financial fields (redacted for Workers per DEC-063 + Contract 11 §8):
 * purchase_price_per_ton, total_purchase_cost, supplier_balance.
 *
 * Nested fields: supplier (object with name + balance), lines (array of
 * objects each with qty + price fields).
 */
export const SAMPLE_RAW_RECEIPT_DTO = {
  id: "00000000-0000-0000-0003-000000000001",
  tenant_id: TEST_TENANT_ID,
  batch_number: "BATCH-001",
  location_id: TEST_LOCATION_A,
  received_qty_kg: "1000.000",
  quality_status: "accepted",
  received_at: "2026-06-28T00:00:00Z",
  // Financial fields (Worker-redacted):
  purchase_price_per_ton: "150.00",
  total_purchase_cost: "150000.00",
  supplier_balance: "75000.00",
  // Nested object with financial field:
  supplier: {
    id: "00000000-0000-0000-0004-000000000001",
    name: "Test Supplier",
    supplier_balance: "75000.00",
  },
  // Nested array with financial fields:
  lines: [
    {
      line_id: 1,
      qty_kg: "500.000",
      price_per_ton: "150.00",
      net_revenue: "75000.00",
    },
    {
      line_id: 2,
      qty_kg: "500.000",
      price_per_ton: "150.00",
      net_revenue: "75000.00",
    },
  ],
} as const;

/**
 * A sample sales-order DTO with financial fields.
 */
export const SAMPLE_SALES_ORDER_DTO = {
  id: "00000000-0000-0000-0003-000000000002",
  tenant_id: TEST_TENANT_ID,
  doc_no: "SO-2026-001",
  status: "pending_approval",
  customer_name: "Test Customer",
  // Financial fields:
  price_per_ton: "200.00",
  gross_revenue: "200000.00",
  discount_amount: "5000.00",
  net_revenue: "195000.00",
  order_discount_total: "5000.00",
  document_total_posted: "195000.00",
  profit_amount: "45000.00",
  profit_margin_percent: "23.08",
  customer_balance: "195000.00",
} as const;

/**
 * A sample chart aggregate DTO with financial datasets.
 */
export const SAMPLE_CHART_DTO = {
  title: "Monthly Revenue",
  labels: ["Jan", "Feb", "Mar"],
  datasets: [
    {
      label: "Quantity (kg)",
      metric: "qty_kg",
      data: [1000, 1100, 1200],
    },
    {
      label: "Net Revenue",
      metric: "net_revenue",
      data: [200000, 220000, 240000],
    },
    {
      label: "Profit Amount",
      metric: "profit_amount",
      data: [45000, 50000, 55000],
    },
  ],
} as const;

/**
 * A sample error object that may leak financial fields if not redacted.
 */
export const SAMPLE_ERROR_OBJECT = {
  message: "Failed to post sales order",
  code: "POSTING_FAILED",
  context: {
    sales_order_id: "00000000-0000-0000-0003-000000000002",
    net_revenue: "195000.00",
    profit_amount: "45000.00",
  },
  details: {
    customer_balance: "195000.00",
    retry_allowed: true,
  },
} as const;
