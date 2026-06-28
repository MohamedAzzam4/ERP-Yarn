/**
 * Proxy (formerly Middleware) — Supabase session refresh + route protection.
 *
 * Contract: docs/contracts/01_technical_architecture_and_deployment_contract.md
 *   §Supabase Auth: "validate the authenticated user on the server for
 *   protected operations"
 *
 * Next.js 16.2.9 stable release renamed the `middleware.ts` file convention
 * to `proxy.ts` (the `middleware` name is officially deprecated and emits a
 * build-time warning). The exported function must be named `proxy` to match.
 * See node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
 * and https://nextjs.org/docs/messages/middleware-to-proxy.
 *
 * This proxy:
 *   1. Refreshes the Supabase session on every request (sets updated cookies).
 *   2. Protects routes that require authentication (redirects to /login).
 *   3. Allows public routes: /login, /api/health, /api/bootstrap, /api/auth/*.
 *
 * The proxy does NOT do ERP user mapping or permission checks —
 * that happens in Server Components via getErpAuthContext(). The proxy
 * only checks if a Supabase session exists (lightweight, Edge-compatible).
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_ROUTES = [
  "/login",
  "/auth/reset-password",
  "/api/health",
  "/api/bootstrap",
  "/api/auth",
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/"),
  );
}

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  // Allow public routes without auth check.
  if (isPublicRoute(request.nextUrl.pathname)) {
    // Still refresh session for public routes (so logout works from login page).
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              response.cookies.set(name, value),
            );
          },
        },
      },
    );
    await supabase.auth.getSession();
    return response;
  }

  // Protected route: check session.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            response.cookies.set(name, value),
          );
        },
      },
    },
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    // Redirect to login with return path.
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Match all paths except static assets and Next.js internals.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js)$).*)",
  ],
};
