import * as React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useDemoStore } from "@/store/DemoStoreContext";
import { routeByActualPath } from "@/routes";
import type { Role } from "@/types";
import { isWorker } from "@/lib/permissions";

/**
 * RouteGuard — enforces demo role visibility on direct route entry.
 *
 * This is PRESENTATION-ONLY. The real ERP enforces permissions server-side.
 * The guard simply redirects a worker who tries to visit a management route
 * back to their worker home, and hides routes the active role may not see.
 */
export interface RouteGuardProps {
  allowedRoles: Role[];
  children: React.ReactNode;
  /** Where to redirect if the role is not allowed. */
  fallbackPath?: string;
}

export function RouteGuard({ allowedRoles, children, fallbackPath }: RouteGuardProps) {
  const { state } = useDemoStore();
  const location = useLocation();

  if (!allowedRoles.includes(state.currentRole)) {
    const target = fallbackPath ?? (isWorker(state.currentRole) ? "/worker" : "/dashboard/owner");
    return <Navigate to={target} replace state={{ from: location }} />;
  }

  return <>{children}</>;
}

/** Convenience hook to determine if the current route is allowed for the role. */
export function useRouteAllowed(path: string): boolean {
  const { state } = useDemoStore();
  const entry = routeByActualPath(path);
  if (!entry) return true;
  return entry.roles.includes(state.currentRole);
}
