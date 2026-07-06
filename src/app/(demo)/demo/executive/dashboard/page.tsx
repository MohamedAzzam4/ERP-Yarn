/**
 * Executive quick-login landing → redirects to the owner dashboard.
 *
 * Route: /demo/executive/dashboard
 *
 * This is the entry point for the "دخول سريع لرئيس مجلس الإدارة" quick-login
 * button on /login. It redirects to the existing /demo/owner/dashboard page
 * with the executive persona. The dashboard page renders with persona="executive"
 * so the topbar shows "رئيس مجلس الإدارة / العضو المنتدب التنفيذي".
 */
import { redirect } from "next/navigation";

export default function ExecutiveDashboardRedirect() {
  redirect("/demo/owner/dashboard?persona=executive");
}
