/**
 * Management Inventory Transfers page — WP-08-01A.
 * Redirects to existing transfers page.
 * Route: /management/inventory/transfers
 */
import { redirect } from "next/navigation";
export default function InventoryTransfersPage() {
  redirect("/management/transfers");
}
