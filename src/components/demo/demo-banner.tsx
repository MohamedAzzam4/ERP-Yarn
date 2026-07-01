/**
 * DemoBanner — persistent banner marking every demo page as synthetic.
 *
 * Sticky, top of the page (above the DemoTopbar) so it stays visible during
 * scrolling. Calm styling — not alarming. Uses warning semantics because
 * "this is fake data" is a cautionary note, not an error.
 *
 * Per docs/demo/01_quick_interactive_showcase_glm_prompt.md:
 *   "Persistent banner on every demo screen: نسخة عرض تفاعلية — بيانات
 *    تجريبية غير حقيقية"
 */
import { cn } from "@/lib/cn";

export function DemoBanner({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "w-full border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-xs font-medium text-warning",
        className,
      )}
    >
      نسخة عرض تفاعلية — بيانات تجريبية غير حقيقية · لا يتم تنفيذ عمليات فعلية ولا
      كتابة إلى قاعدة البيانات
    </div>
  );
}
