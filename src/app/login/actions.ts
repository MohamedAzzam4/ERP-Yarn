/**
 * Login server actions — email/password sign-in, sign-out, password reset.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §4.1 Login:
 *   "Forbidden actions: Public signup, fake role selection, client-assigned
 *    tenant/role, revealing whether a forbidden account exists."
 *
 * DEC-073: Private email/password sign-in through Supabase Auth.
 * No public signup. No role selector.
 *
 * All auth responses are enumeration-safe — they do not reveal whether
 * an email exists in the system.
 *
 * Note: Server actions used in `<form action={...}>` must return void.
 * Errors are communicated via redirect to /login with an error query param.
 */
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Sign in with email and password.
 *
 * On success: redirects to the return path (default "/").
 * On failure: redirects to /login with a generic error (enumeration-safe).
 */
export async function signIn(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const redirectTo = (formData.get("redirect") as string) || "/";

  if (!email || !password) {
    redirect("/login?error=incomplete");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Generic error — do not reveal whether the email exists.
    redirect("/login?error=invalid");
  }

  revalidatePath("/", "layout");
  redirect(redirectTo);
}

/**
 * Sign out the current user.
 */
export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

/**
 * Request a password reset email.
 *
 * Always redirects to /login with a generic success message
 * (enumeration-safe — does not reveal whether the email exists).
 */
export async function requestPasswordReset(formData: FormData) {
  const email = formData.get("email") as string;

  if (!email) {
    redirect("/login?error=email_required");
  }

  const supabase = await createSupabaseServerClient();

  try {
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(
        ".supabase.co",
        "",
      )}/auth/reset-password`,
    });
  } catch {
    // Ignore errors — return generic success.
  }

  // Always redirect with success (enumeration-safe).
  redirect("/login?reset=sent");
}

/**
 * Update password (called from the reset-password page after email callback).
 *
 * On success: redirects to /login.
 * On failure: redirects to /auth/reset-password with error.
 */
export async function updatePassword(formData: FormData) {
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!password || password.length < 8) {
    redirect("/auth/reset-password?error=short");
  }

  if (password !== confirmPassword) {
    redirect("/auth/reset-password?error=mismatch");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    redirect("/auth/reset-password?error=failed");
  }

  revalidatePath("/", "layout");
  redirect("/login?reset=done");
}
