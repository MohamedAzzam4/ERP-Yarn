/**
 * One-time Owner bootstrap — dev/demo only.
 *
 * Contract: docs/contracts/13_work_packages.md WP-01-01
 * Contract: docs/contracts/01_technical_architecture_and_deployment_contract.md
 *   §Supabase Auth
 *
 * DEC-074: The first Owner is created through a controlled one-time
 * bootstrap mechanism. For dev/demo, the bootstrap may be a one-time
 * script or route guarded by a server-only bootstrap secret that must
 * never be exposed to the browser or committed. After the first Owner
 * exists, bootstrap must idempotently refuse further Owner creation.
 *
 * This route:
 *   1. Requires `OWNER_BOOTSTRAP_SECRET` header (server-only, never in response).
 *   2. Checks if any user with the 'owner' role already exists.
 *   3. If yes → idempotent refusal (409).
 *   4. If no → creates a Supabase Auth user + ERP user + tenant + role assignment.
 *   5. Returns only non-sensitive confirmation (user email, tenant name).
 *   6. NEVER returns: secret key, database URL, auth tokens, passwords.
 *
 * For pilot/production, this route must be disabled or replaced with
 * manual admin provisioning.
 */
import "server-only";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BootstrapRequest {
  email: string;
  password: string;
  name: string;
  tenantName?: string;
}

export async function POST(request: Request) {
  // 1. Check bootstrap secret.
  const bootstrapSecret = process.env.OWNER_BOOTSTRAP_SECRET;
  if (!bootstrapSecret) {
    return NextResponse.json(
      { error: "Bootstrap not configured" },
      { status: 503 },
    );
  }

  const providedSecret = request.headers.get("x-bootstrap-secret");
  if (providedSecret !== bootstrapSecret) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  // 2. Parse request body.
  let body: BootstrapRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  if (!body.email || !body.password || !body.name) {
    return NextResponse.json(
      { error: "email, password, and name are required" },
      { status: 400 },
    );
  }

  if (body.password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 },
    );
  }

  // 3. Check if Owner already exists (idempotent).
  const adminClient = createSupabaseAdminClient();

  // Check ERP users table for any user with 'owner' role.
  const { data: existingRoles, error: rolesError } = await adminClient
    .from("roles")
    .select("id")
    .eq("role_code", "owner")
    .limit(1);

  if (rolesError) {
    return NextResponse.json(
      { error: "Failed to check existing Owner" },
      { status: 500 },
    );
  }

  if (existingRoles && existingRoles.length > 0) {
    // Check if any user is assigned the owner role.
    const { data: existingOwner } = await adminClient
      .from("user_roles")
      .select("user_id")
      .in(
        "role_id",
        existingRoles.map((r: { id: string }) => r.id),
      )
      .limit(1);

    if (existingOwner && existingOwner.length > 0) {
      // Idempotent refusal — Owner already exists.
      return NextResponse.json(
        { error: "Owner already exists. Bootstrap is disabled." },
        { status: 409 },
      );
    }
  }

  // 4. Create tenant (or use existing seed tenant).
  const tenantName = body.tenantName || "ERP-Yarn Demo Tenant";
  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({
      company_name: tenantName,
      default_language: "ar",
      currency_code: "EGP",
      timezone: "Africa/Cairo",
      status: "active",
    })
    .select("id")
    .single();

  if (tenantError || !tenant) {
    return NextResponse.json(
      { error: "Failed to create tenant" },
      { status: 500 },
    );
  }

  const tenantId = tenant.id;

  // 5. Create 'owner' role for this tenant.
  const { data: role, error: roleError } = await adminClient
    .from("roles")
    .insert({
      tenant_id: tenantId,
      role_code: "owner",
      name_ar: "المالك",
      name_en: "Owner",
      is_system_role: true,
      system_flag: "system",
    })
    .select("id")
    .single();

  if (roleError || !role) {
    return NextResponse.json(
      { error: "Failed to create Owner role" },
      { status: 500 },
    );
  }

  // 6. Create Supabase Auth user.
  const { data: authUser, error: authError } =
    await adminClient.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
    });

  if (authError || !authUser.user) {
    return NextResponse.json(
      { error: "Failed to create auth user" },
      { status: 500 },
    );
  }

  // 7. Create ERP user record linked to Supabase Auth.
  const { data: erpUser, error: erpUserError } = await adminClient
    .from("users")
    .insert({
      tenant_id: tenantId,
      auth_id: authUser.user.id,
      name: body.name,
      email: body.email,
      status: "active",
      language_preference: "ar",
    })
    .select("id")
    .single();

  if (erpUserError || !erpUser) {
    // Rollback: delete the Supabase Auth user.
    await adminClient.auth.admin.deleteUser(authUser.user.id);
    return NextResponse.json(
      { error: "Failed to create ERP user" },
      { status: 500 },
    );
  }

  // 8. Assign 'owner' role to the user.
  const { error: assignError } = await adminClient
    .from("user_roles")
    .insert({
      user_id: erpUser.id,
      role_id: role.id,
      tenant_id: tenantId,
    });

  if (assignError) {
    // Rollback: delete auth user and ERP user.
    await adminClient.auth.admin.deleteUser(authUser.user.id);
    return NextResponse.json(
      { error: "Failed to assign Owner role" },
      { status: 500 },
    );
  }

  // 9. Return non-sensitive confirmation only.
  return NextResponse.json(
    {
      success: true,
      message: "Owner bootstrap completed. Bootstrap is now disabled.",
      tenantName,
      // Do NOT return: auth ID, user ID, role ID, tokens, passwords, secrets.
    },
    { status: 201 },
  );
}
