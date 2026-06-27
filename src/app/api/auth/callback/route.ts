import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase Auth callback — handles OAuth/magic-link/recovery redirects.
 *
 * When Supabase Auth sends a recovery email, the link points to this
 * callback. Supabase exchanges the code for a session, then we redirect
 * to the password reset page.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §4.2:
 *   "Recovery cannot create or activate an ERP user or change permissions."
 *
 * runtime = "nodejs" per DEC-038.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const type = requestUrl.searchParams.get("type");

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
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
              // Server Component — can be ignored with proxy.
            }
          },
        },
      },
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      // Redirect to login with generic error (enumeration-safe).
      return NextResponse.redirect(new URL("/login", request.url));
    }

    // If this is a recovery flow, redirect to password reset page.
    if (type === "recovery") {
      return NextResponse.redirect(
        new URL("/auth/reset-password", request.url),
      );
    }
  }

  // Default redirect after auth callback.
  return NextResponse.redirect(new URL("/", request.url));
}
