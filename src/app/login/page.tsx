import { signIn, requestPasswordReset } from "./actions";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EgycotLogo, EGYCOT_NAME_AR, EGYCOT_NAME_EN } from "@/components/demo/egycot-logo";

/**
 * Login page — private email/password sign-in.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §4.1 Login
 * DEC-073: Private email/password sign-in through Supabase Auth.
 *
 * Redirect handling: reads searchParams.redirect, sanitizes to internal
 * paths only (prevents open-redirect attacks).
 *
 * Error feedback: query params error/reset rendered as visible Arabic
 * Alert messages (enumeration-safe).
 */

function sanitizeRedirect(value: string | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value.slice(1).includes("://")) return "/";
  return value;
}

const ERROR_MESSAGES: Record<string, { variant: "danger" | "warning" | "info" | "success"; title: string; message: string }> = {
  invalid: { variant: "danger", title: "خطأ في تسجيل الدخول", message: "البريد الإلكتروني أو كلمة المرور غير صحيحة. حاول مرة أخرى." },
  incomplete: { variant: "warning", title: "بيانات ناقصة", message: "يرجى إدخال البريد الإلكتروني وكلمة المرور." },
  no_role: { variant: "warning", title: "لا يوجد دور مخصص", message: "لا يوجد دور مخصص لحسابك. تواصل مع المسؤول." },
  email_required: { variant: "warning", title: "بريد إلكتروني مطلوب", message: "يرجى إدخال البريد الإلكتروني لاستعادة كلمة المرور." },
};

const RESET_MESSAGES: Record<string, { variant: "info" | "success"; title: string; message: string }> = {
  sent: { variant: "info", title: "تم الإرسال", message: "إذا كان البريد الإلكتروني مسجلاً، ستصلك رابط استعادة كلمة المرور." },
  done: { variant: "success", title: "تم التحديث", message: "تم تحديث كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن." },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; error?: string; reset?: string }>;
}) {
  const params = await searchParams;
  const safeRedirect = sanitizeRedirect(params.redirect);
  const errorInfo = params.error ? ERROR_MESSAGES[params.error] : undefined;
  const resetInfo = params.reset ? RESET_MESSAGES[params.reset] : undefined;

  return (
    <div
      className="egycot-login-bg min-h-screen flex items-center justify-center p-4"
      style={{ backgroundImage: "url(/brand/login-background.png)", backgroundSize: "cover", backgroundPosition: "center" }}
    >
      {/* Light overlay for readability over the background image */}
      <div className="absolute inset-0 bg-white/40 z-0" aria-hidden="true" />

      <div className="relative z-10 w-full max-w-md">
        {/* EGYCOT branding — logo + company names above the login card */}
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <EgycotLogo size={64} showText={false} />
          <h1 className="font-heading text-lg font-bold text-navy">
            {EGYCOT_NAME_AR}
          </h1>
          <p className="text-xs text-muted-foreground" dir="ltr">
            {EGYCOT_NAME_EN}
          </p>
        </div>

        {/* Glassmorphism login card */}
        <Card className="w-full border border-white/40 bg-white/65 backdrop-blur-xl shadow-lg">
        <CardHeader>
          <CardTitle className="text-center text-heading-3">تسجيل الدخول</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorInfo && (
            <Alert variant={errorInfo.variant} role="alert">
              <AlertDescription>
                <p className="font-semibold">{errorInfo.title}</p>
                <p className="mt-1">{errorInfo.message}</p>
              </AlertDescription>
            </Alert>
          )}
          {resetInfo && (
            <Alert variant={resetInfo.variant} role="status">
              <AlertDescription>
                <p className="font-semibold">{resetInfo.title}</p>
                <p className="mt-1">{resetInfo.message}</p>
              </AlertDescription>
            </Alert>
          )}
          <form action={signIn} className="space-y-4">
            <input type="hidden" name="redirect" value={safeRedirect} />
            <div className="space-y-2">
              <label htmlFor="email" className="text-label">البريد الإلكتروني</label>
              <input id="email" name="email" type="email" required dir="ltr" className="w-full rounded-md border border-input bg-surface px-3 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="user@example.com" />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-label">كلمة المرور</label>
              <input id="password" name="password" type="password" required dir="ltr" className="w-full rounded-md border border-input bg-surface px-3 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="••••••••" />
            </div>
            <SubmitButton className="w-full" loadingText="جاري تسجيل الدخول...">دخول</SubmitButton>
          </form>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">نسيت كلمة المرور؟</summary>
            <form action={requestPasswordReset} className="mt-2 space-y-2">
              <input name="email" type="email" required dir="ltr" className="w-full rounded-md border border-input bg-surface px-3 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="user@example.com" />
              <Button type="submit" variant="outline" className="w-full min-h-[44px]">إرسال رابط الاستعادة</Button>
            </form>
          </details>
          {/* Quick demo login — 3 persona choices (replaces old single demo link) */}
          <div className="border-t border-border pt-3">
            <p className="text-center text-xs text-muted-foreground mb-2">
              دخول سريع للعرض التفاعلي (بيانات تجريبية)
            </p>
            <div className="space-y-2">
              <a
                href="/demo/executive/dashboard"
                className="flex min-h-[44px] w-full items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                دخول سريع لرئيس مجلس الإدارة / العضو المنتدب التنفيذي
              </a>
              <a
                href="/demo/accountant/dashboard"
                className="flex min-h-[44px] w-full items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                دخول سريع للمحاسب
              </a>
              <a
                href="/demo/data-entry"
                className="flex min-h-[44px] w-full items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                دخول سريع لمسؤول إدخال البيانات
              </a>
            </div>
            <p className="mt-2 text-center text-[10px] text-muted-foreground">
              عرض تفاعلي تجريبي — لا يتطلب بيانات اعتماد فعلية
            </p>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
