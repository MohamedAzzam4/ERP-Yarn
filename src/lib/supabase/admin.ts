/**
 * Supabase admin client for server-only privileged operations.
 *
 * Contract: docs/contracts/01_technical_architecture_and_deployment_contract.md
 *   §Secrets: "The Supabase secret/service-role credential... are server-only."
 *   §Supabase Auth: "Supabase secret/service credentials bypass RLS and must
 *   remain server-only."
 *
 * DEC-073: Supabase Auth identity is authentication only.
 * DEC-074: Owner bootstrap uses admin API to create the first Supabase Auth user.
 *
 * This client uses SUPABASE_SECRET_KEY (server-only). It must NEVER be
 * imported from client code. The `server-only` guard enforces this.
 *
 * Use cases:
 *   - Owner bootstrap: create Supabase Auth user
 *   - User provisioning (future): invite/create users via admin API
 *
 * Do NOT use this client for normal auth/session operations — use the
 * server client (server.ts) with the publishable key instead.
 */
import "server-only";
import { createClient } from "@supabase/supabase-js";

export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
