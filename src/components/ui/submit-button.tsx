"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/**
 * Submit button with pending/loading state for server-action forms.
 *
 * Uses useFormStatus() from react-dom to detect when the server action
 * is in flight. While pending:
 *   - disables the button
 *   - shows Arabic loading text "جاري تسجيل الدخول..."
 *   - shows a CSS spinner
 *   - prevents double submit
 *
 * Must be rendered inside a <form> that uses a server action.
 */
export function SubmitButton({
  children,
  variant = "primary",
  className = "",
  loadingText = "جاري تسجيل الدخول...",
}: {
  children: React.ReactNode;
  variant?: "primary" | "outline" | "secondary";
  className?: string;
  loadingText?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant={variant}
      disabled={pending}
      className={`min-h-[44px] ${className} ${pending ? "cursor-wait" : ""}`}
      aria-busy={pending}
      aria-label={pending ? loadingText : undefined}
    >
      {pending ? (
        <span className="flex items-center justify-center gap-2">
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
          {loadingText}
        </span>
      ) : (
        children
      )}
    </Button>
  );
}
