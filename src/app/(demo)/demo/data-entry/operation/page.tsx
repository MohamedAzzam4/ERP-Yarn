/**
 * Data-entry → operation redirect.
 * Route: /demo/data-entry/operation → /demo/owner/operation
 */
import { redirect } from "next/navigation";

export default function DataEntryOperationRedirect() {
  redirect("/demo/owner/operation");
}
