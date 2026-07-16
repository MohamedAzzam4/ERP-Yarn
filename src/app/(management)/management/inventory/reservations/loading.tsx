/**
 * Loading state for worker stock-transfer.
 * Contract 10 §7.1: States include loading.
 */
export default function Loading() {
  return (
    <div className="flex items-center justify-center py-12">
      <p className="text-muted-foreground">جارٍ التحميل...</p>
    </div>
  );
}
