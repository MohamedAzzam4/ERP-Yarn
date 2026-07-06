/**
 * Data-entry → purchase redirect.
 * Route: /demo/data-entry/purchase → /demo/owner/purchase
 */
import { redirect } from "next/navigation";

export default function DataEntryPurchaseRedirect() {
  redirect("/demo/owner/purchase");
}
