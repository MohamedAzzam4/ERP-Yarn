import { default as clsx } from "clsx";

/**
 * Foundation home page for ERP-Yarn.
 *
 * WP-00-02 scope: shows that the contracted stack builds and renders an
 * Arabic-first RTL shell. No business navigation, no auth, no dashboard.
 * Real screens land in WP-00-05+ after the reference-screen approval gate.
 *
 * Contract: docs/contracts/13_work_packages.md WP-00-02 ("App can start
 * without domain features and configuration is reproducible.")
 */
export default function HomePage() {
  return (
    <main
      className={clsx(
        "min-h-screen",
        "flex flex-col items-center justify-center gap-6 p-8",
      )}
    >
      <h1
        className="text-3xl font-bold"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        نظام إدارة تجارة وتشغيل الغزل لدى الغير
      </h1>
      <p className="text-base text-muted-foreground" dir="rtl">
        WP-00-02 — Technical Stack and Environment Setup (foundation only).
      </p>
      <p className="text-sm text-muted-foreground" dir="rtl">
        المرحلة 0 — الأساس التقني. لا توجد ميزات أعمال بعد.
      </p>
      <hr className="w-full max-w-md border-border" />
      <p className="text-xs text-muted-foreground" dir="rtl">
        Next.js 16.2.9 · React 19 · TypeScript 5.9 · Tailwind v4 · Drizzle ·
        postgres.js · Supabase SSR
      </p>
    </main>
  );
}
