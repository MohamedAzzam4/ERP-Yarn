/**
 * Supabase browser client for client-side auth operations.
 *
 * Contract: docs/contracts/01_technical_architecture_and_deployment_contract.md
 *   §Supabase Auth: "use @supabase/ssr for Next.js server/browser session integration"
 *
 * DEC-073: Private email/password sign-in through Supabase Auth.
 * Uses the publishable key (browser-safe, not the secret key).
 */
import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
