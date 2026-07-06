/**
 * Accountant quick-login landing → redirects to the owner dashboard.
 *
 * Route: /demo/accountant/dashboard
 *
 * This is the entry point for the "دخول سريع للمحاسب" quick-login button on
 * /login. It redirects to the existing /demo/owner/dashboard page with the
 * accountant persona. The dashboard page renders with persona="accountant"
 * so the topbar shows "المدير المالي".
 *
 * The accountant has access to the same demo management screens as the
 * executive — both personas share the management dashboard/reviews/overviews.
 */
import { redirect } from "next/navigation";

export default function AccountantDashboardRedirect() {
  redirect("/demo/owner/dashboard?persona=accountant");
}
