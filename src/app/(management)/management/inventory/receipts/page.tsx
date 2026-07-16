/**
 * Management Inventory Receipts page — WP-08-01A.
 * Redirects to existing raw-receipt-approvals page.
 * Route: /management/inventory/receipts
 */
import { redirect } from "next/navigation";
export default function InventoryReceiptsPage() {
  redirect("/management/raw-receipt-approvals");
}
