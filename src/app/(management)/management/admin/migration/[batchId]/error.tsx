"use client";

export default function MigrationBatchDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] gap-4">
      <div role="alert" className="text-destructive text-center">
        <p className="font-semibold">حدث خطأ أثناء تحميل تفاصيل الدفعة.</p>
        <p className="text-sm mt-1">{error.message}</p>
      </div>
      <button
        onClick={reset}
        className="px-4 py-2 border rounded text-sm hover:bg-muted"
        style={{ minHeight: "44px" }}
      >
        إعادة المحاولة
      </button>
    </div>
  );
}
