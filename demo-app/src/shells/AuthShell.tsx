import { Link, Outlet } from "react-router-dom";
import { Factory } from "lucide-react";
import { DemoBanner } from "@/components/shared/DemoBanner";
import { BidiValue } from "@/components/shared/BidiValue";

/**
 * AuthShell — neutral authentication shell for the demo login and recovery
 * screens. No business/financial preview.
 */
export function AuthShell() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <DemoBanner />
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <Link to="/" className="inline-flex items-center justify-center gap-2 text-primary">
              <Factory className="h-8 w-8" aria-hidden />
              <span className="font-heading text-xl font-bold">عرض ERP التفاعلي</span>
            </Link>
            <p className="mt-1 text-xs text-muted-foreground" dir="rtl">
              <BidiValue size="xs">Quick Interactive ERP Showcase</BidiValue>
            </p>
          </div>
          <Outlet />
        </div>
      </main>
      <footer className="px-4 py-3 text-center text-xs text-muted-foreground">
        نسخة عرض تفاعلية — ليست النسخة التشغيلية للـ ERP.
      </footer>
    </div>
  );
}
