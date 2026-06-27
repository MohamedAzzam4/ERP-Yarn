import { getErpAuthContext } from "@/server/auth/erp-context";
import { signOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Home page — requires authenticated ERP user.
 *
 * If the middleware allows the request through (session exists), this
 * Server Component resolves the ERP auth context. If the Supabase Auth
 * user is unmapped or inactive, a denial message is shown.
 *
 * WP-01-01 scope: minimal auth-aware home. No business screens yet.
 */

export default async function HomePage() {
  const authResult = await getErpAuthContext();

  if (!authResult.authenticated) {
    return (
      <Container size="sm" className="flex min-h-screen items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center">غير مصرح</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-body text-muted-foreground text-center">
              {authResult.reason === "unmapped" &&
                "المستخدم غير مرتبط بحساب ERP"}
              {authResult.reason === "inactive" &&
                "الحساب غير نشط. تواصل مع المسؤول"}
              {authResult.reason === "no_session" && "انتهت الجلسة"}
            </p>
            <form action={signOut}>
              <Button type="submit" variant="outline" className="w-full">
                تسجيل الخروج
              </Button>
            </form>
          </CardContent>
        </Card>
      </Container>
    );
  }

  return (
    <Container size="md" className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-center">
            نظام إدارة تجارة وتشغيل الغزل لدى الغير
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-body text-muted-foreground text-center">
            مرحباً، {authResult.name}
          </p>
          <p className="text-sm text-muted-foreground text-center">
            المرحلة 1 — WP-01-01: المصادقة الخاصة (أساس)
          </p>
          <form action={signOut}>
            <Button type="submit" variant="outline" className="w-full">
              تسجيل الخروج
            </Button>
          </form>
        </CardContent>
      </Card>
    </Container>
  );
}
