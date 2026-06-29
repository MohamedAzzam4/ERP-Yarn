/**
 * Worker Task Mode Shell.
 *
 * Contract: docs/contracts/02_design_system_and_ux_contract.md
 *   §Worker Task Mode (lines 299-333)
 *   - Task-first, not module-first
 *   - Few screens, large touch targets, minimal navigation
 *   - No financial terminology
 *   - Responsive from 360px upward
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §5.1
 *   - Role-authorized task cards
 *   - No module tree, no financial widgets, no audit/migration/settings
 *   - 44×44px minimum touch targets
 *   - One column at 360px
 *
 * Contract: docs/contracts/14_coding_agent_instructions.md
 *   "Worker screens must not be reduced-size versions of management screens."
 */
import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import type { WorkerTaskItem } from "./nav-config";

// ---------------------------------------------------------------------------
// WorkerShell — the task-first layout wrapper.
// ---------------------------------------------------------------------------

export interface WorkerShellProps {
  /** The authenticated worker's display name. */
  userName: string;
  /** Task cards to display (already role-filtered). */
  tasks: ReadonlyArray<WorkerTaskItem>;
  /** Sign-out action. */
  onSignOut?: () => void;
  /** Children (the page content below the task grid). */
  children?: React.ReactNode;
}

/**
 * Worker Task Mode Shell.
 *
 * Layout:
 *   ┌─────────────────────────────────┐
 *   │  Header (name + sign out)       │
 *   ├─────────────────────────────────┤
 *   │  Task grid (large cards)        │
 *   │  ┌────┐ ┌────┐ ┌────┐          │
 *   │  │task│ │task│ │task│          │
 *   │  └────┘ └────┘ └────┘          │
 *   ├─────────────────────────────────┤
 *   │  Page content (children)        │
 *   └─────────────────────────────────┘
 *
 * Responsive:
 *   - 360px: 1 column, full-width cards
 *   - 640px+: 2 columns
 *   - 1024px+: 3 columns
 *
 * Touch targets: all task cards are at least 44×44px (via min-h-[44px] on
 * the link, and the card padding ensures the full card is tappable).
 */
export function WorkerShell({ userName, tasks, onSignOut, children }: WorkerShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <header
        className="sticky top-0 z-10 border-b border-border bg-surface"
        role="banner"
      >
        <Container size="md">
          <div className="flex items-center justify-between gap-4 py-4">
            <div>
              <h1 className="text-heading-3 text-foreground">المهام</h1>
              <p className="text-sm text-muted-foreground">{userName}</p>
            </div>
            {onSignOut && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onSignOut}
                aria-label="تسجيل الخروج"
              >
                خروج
              </Button>
            )}
          </div>
        </Container>
      </header>

      <main role="main" className="py-6">
        <Container size="md">
          {tasks.length === 0 ? (
            <p className="text-body text-muted-foreground text-center py-8">
              لا توجد مهام متاحة لك حالياً
            </p>
          ) : (
            <nav aria-label="المهام" className="mb-8">
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {tasks.map((task) => (
                  <li key={task.id}>
                    <WorkerTaskCard task={task} />
                  </li>
                ))}
              </ul>
            </nav>
          )}

          {children}
        </Container>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkerTaskCard — large tappable card.
// ---------------------------------------------------------------------------

export interface WorkerTaskCardProps {
  task: WorkerTaskItem;
}

/**
 * Individual task card.
 *
 * - Large touch target (min-h-[88px] for the full card — exceeds 44×44px)
 * - Arabic label, no financial terminology
 * - Link to the task route (role-filtered by nav-config before rendering)
 * - Accessible: uses <a> with proper aria-label
 */
export function WorkerTaskCard({ task }: WorkerTaskCardProps) {
  return (
    <Link
      href={task.href}
      className={cn(
        "flex min-h-[88px] flex-col items-start gap-2 rounded-lg border border-border bg-surface p-5",
        "transition-colors hover:border-primary hover:bg-muted",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      )}
      aria-label={task.labelAr}
    >
      <span className="text-heading-4 text-foreground">{task.labelAr}</span>
      <span className="text-sm text-muted-foreground" dir="ltr">
        {task.href}
      </span>
    </Link>
  );
}
