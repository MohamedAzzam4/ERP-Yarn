"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  const isPermissionDenied = error.message.includes("PERMISSION_DENIED") || error.message.includes("FORBIDDEN_FIELD");
  const message = isPermissionDenied
    ? "غير مصرح: لا يمكنك الوصول إلى هذه الشاشة."
    : "حدث خطأ. حاول مرة أخرى.";

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4">
      <p role="alert" className="text-red-600 font-medium">{message}</p>
      <button onClick={reset} className="px-4 py-2 border rounded text-sm" style={{ minHeight: "44px" }}>
        إعادة المحاولة
      </button>
    </div>
  );
}
