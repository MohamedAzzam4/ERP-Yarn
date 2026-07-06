/**
 * Data-entry → yarn-movement redirect.
 * Route: /demo/data-entry/yarn-movement → /demo/owner/yarn-movement
 */
import { redirect } from "next/navigation";

export default function DataEntryYarnMovementRedirect() {
  redirect("/demo/owner/yarn-movement");
}
