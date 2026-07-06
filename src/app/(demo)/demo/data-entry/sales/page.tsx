/**
 * Data-entry → sales redirect.
 * Route: /demo/data-entry/sales → /demo/owner/sales-entry
 */
import { redirect } from "next/navigation";

export default function DataEntrySalesRedirect() {
  redirect("/demo/owner/sales-entry");
}
