import { AlertTriangle } from "lucide-react";

/**
 * Persistent banner shown on every screen. Mirrors the requirement in
 * /docs/demo/01_quick_interactive_showcase_glm_prompt.md §6.
 */
export function DemoBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="demo-banner flex items-center justify-center gap-2 px-4 py-2 text-center text-sm font-medium"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      <span>نسخة عرض تفاعلية — بيانات تجريبية غير حقيقية</span>
    </div>
  );
}
