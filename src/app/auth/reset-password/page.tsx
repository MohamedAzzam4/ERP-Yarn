import { updatePassword } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Container } from "@/components/ui/container";

/**
 * Password reset page — reached after clicking the recovery email link.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §4.2:
 *   "Recovery cannot create or activate an ERP user or change permissions."
 *
 * This page only updates the Supabase Auth password. It does NOT:
 *   - create or activate ERP users
 *   - change ERP roles or permissions
 *   - grant tenant membership
 */

export default function ResetPasswordPage() {
  return (
    <Container size="sm" className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">إعادة تعيين كلمة المرور</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updatePassword} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="password" className="text-label">
                كلمة المرور الجديدة
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                dir="ltr"
                className="w-full rounded-md border border-input bg-surface px-3 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="••••••••"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="text-label">
                تأكيد كلمة المرور
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                minLength={8}
                dir="ltr"
                className="w-full rounded-md border border-input bg-surface px-3 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="••••••••"
              />
            </div>

            <Button type="submit" className="w-full" size="lg">
              تحديث كلمة المرور
            </Button>
          </form>
        </CardContent>
      </Card>
    </Container>
  );
}
