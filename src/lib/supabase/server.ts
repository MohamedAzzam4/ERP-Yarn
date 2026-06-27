/**
 * Supabase server client for Server Components and Route Handlers.
 *
 * Contract: docs/contracts/01_technical_architecture_and_deployment_contract.md
 *   §Supabase Auth: "use @supabase/ssr for Next.js server/browser session integration"
 *
 * Uses the publishable key (browser-safe). The secret key is NOT used here —
 * it is reserved for admin operations (see admin.ts).
 *
 * Session cookies are managed through Next.js cookies() API.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have a proxy refreshing sessions.
          }
        },
      },
    },
  );
}
