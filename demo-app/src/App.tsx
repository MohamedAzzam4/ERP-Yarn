import { lazy, Suspense, useMemo } from "react";
import { createBrowserRouter, Navigate, RouterProvider, type RouteObject } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DemoStoreProvider, useDemoStore } from "@/store/DemoStoreContext";
import { ROUTES } from "@/routes";
import { isWorker } from "@/lib/permissions";
import { AuthShell } from "@/shells/AuthShell";
import { WorkerShell } from "@/shells/WorkerShell";
import { ManagementShell } from "@/shells/ManagementShell";
import { RouteGuard } from "@/shells/RouteGuard";

function LoadingFallback() {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
      <span
        className="me-2 h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-accent"
        aria-hidden
      />
      جاري التحميل...
    </div>
  );
}

function buildRouterObjects(): RouteObject[] {
  // Group routes by shell.
  const authRoutes = ROUTES.filter(
    (r) => r.group === "access" && (r.path === "/login" || r.path === "/recovery"),
  );
  const workerRoutes = ROUTES.filter(
    (r) => ["warehouse", "production", "quality"].includes(r.group) || r.path === "/worker",
  );
  const managementRoutes = ROUTES.filter(
    (r) =>
      !["access"].includes(r.group) &&
      !workerRoutes.includes(r) &&
      !authRoutes.includes(r) &&
      r.path !== "/worker" &&
      r.path !== "/all-screens",
  );
  const allScreensRoute = ROUTES.find((r) => r.path === "/all-screens")!;

  const wrap = (entry: (typeof ROUTES)[number]) => {
    const Comp = lazy(entry.element);
    return {
      path: entry.path,
      element: (
        <RouteGuard allowedRoles={entry.roles}>
          <Suspense fallback={<LoadingFallback />}>
            <Comp />
          </Suspense>
        </RouteGuard>
      ),
    };
  };

  return [
    {
      path: "/",
      element: <RootRedirect />,
    },
    {
      element: <AuthShell />,
      children: authRoutes.map(wrap),
    },
    {
      element: <WorkerShell />,
      children: workerRoutes.map(wrap),
    },
    {
      element: <ManagementShell />,
      children: [...managementRoutes.map(wrap), wrap(allScreensRoute)],
    },
    {
      path: "*",
      element: <NotFound />,
    },
  ];
}

function RootRedirect() {
  const { state } = useDemoStore();
  const target = isWorker(state.currentRole) ? "/worker" : "/dashboard/owner";
  return <Navigate to={target} replace />;
}

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
      <p className="font-heading text-2xl font-bold text-foreground">404</p>
      <p className="text-sm text-muted-foreground" dir="rtl">
        هذه الصفحة غير موجودة في العرض التفاعلي.
      </p>
      <a href="/" className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
        العودة للرئيسية
      </a>
    </div>
  );
}

function Router() {
  const router = useMemo(() => createBrowserRouter(buildRouterObjects()), []);
  return <RouterProvider router={router} />;
}

export default function App() {
  return (
    <DemoStoreProvider>
      <TooltipProvider>
        <Router />
      </TooltipProvider>
    </DemoStoreProvider>
  );
}
