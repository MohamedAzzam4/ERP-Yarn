import { signIn, requestPasswordReset } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * Login page — private email/password sign-in.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §4.1 Login:
 *   - "Visible fields: Approved private identifier, credential/control
 *      required by the eventual auth decision, Arabic labels, submit,
 *      support/recovery entry when approved."
 *   - "Hidden fields: Tenant ID, role selector, permission preview, service
 *      keys, internal auth metadata."
 *   - "Forbidden actions: Public signup, fake role selection, client-assigned
 *      tenant/role, revealing whether a forbidden account exists."
 *
 * DEC-073: Private email/password sign-in through Supabase Auth.
 * No public signup. No role selector. No tenant selector.
 *
 * Arabic-first RTL. Email isolated as LTR (per Contract 02 §Local LTR Isolation).
 */

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  return (
    <Container size="sm" className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">تسجيل الدخول</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={signIn} className="space-y-4">
            {/* Redirect target after login */}
            <input type="hidden" name="redirect" value="/login?redirect=/" />

            <div className="space-y-2">
              <label htmlFor="email" className="text-label">
                البريد الإلكتروني
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                dir="ltr"
                className="w-full rounded-md border border-input bg-surface px-3 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="user@example.com"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-label">
                كلمة المرور
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                dir="ltr"
                className="w-full rounded-md border border-input bg-surface px-3 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="••••••••"
              />
            </div>

            <Button type="submit" className="w-full" size="lg">
              دخول
            </Button>
          </form>

          {/* Password recovery — enumeration-safe */}
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-muted-foreground">
              نسيت كلمة المرور؟
            </summary>
            <form action={requestPasswordReset} className="mt-2 space-y-2">
              <input
                name="email"
                type="email"
                required
                dir="ltr"
                className="w-full rounded-md border border-input bg-surface px-3 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="user@example.com"
              />
              <Button type="submit" variant="outline" className="w-full">
                إرسال رابط الاستعادة
              </Button>
            </form>
          </details>

          {/* No signup link — DEC-073 forbids public signup */}
        </CardContent>
      </Card>
    </Container>
  );
}
