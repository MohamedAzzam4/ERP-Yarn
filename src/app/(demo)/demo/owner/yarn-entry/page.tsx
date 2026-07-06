/**
 * Redirect: /demo/owner/yarn-entry → /demo/owner/purchase
 *
 * The old yarn-entry page has been replaced by the grouped purchase input
 * page (إدخال الشراء) with tabs for شراء خامات / شراء خيوط.
 * This redirect keeps old links working without showing two systems at once.
 */
import { redirect } from "next/navigation";

export default function YarnEntryRedirect() {
  redirect("/demo/owner/purchase");
}
