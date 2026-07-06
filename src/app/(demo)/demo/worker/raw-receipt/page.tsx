/**
 * Redirect: /demo/worker/raw-receipt → /demo/owner/purchase
 *
 * The old worker raw-receipt page has been replaced by the grouped purchase
 * input page (إدخال الشراء) with tabs for شراء خامات / شراء خيوط.
 * This redirect keeps old links working without showing two systems at once.
 */
import { redirect } from "next/navigation";

export default function RawReceiptRedirect() {
  redirect("/demo/owner/purchase");
}
