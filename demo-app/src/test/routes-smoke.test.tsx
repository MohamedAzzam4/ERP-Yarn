import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { Suspense, lazy, type ComponentType } from "react";
import { DemoStoreProvider } from "@/store/DemoStoreContext";
import { ROUTES } from "@/routes";
import { ROLES, type Role } from "@/types";

/**
 * Route smoke test — render every required static screen for at least one
 * role that may see it. We bypass the RouteGuard (which depends on async
 * role state) and pass the role directly to the provider. The screen
 * passes if it renders without throwing and produces any DOM output.
 */
const CACHE = new Map<string, ComponentType>();
function lazyOf(path: string): ComponentType {
  if (CACHE.has(path)) return CACHE.get(path)!;
  const entry = ROUTES.find((r) => r.path === path)!;
  const Comp = lazy(entry.element);
  CACHE.set(path, Comp);
  return Comp;
}

function renderRoute(path: string, role: Role) {
  const Comp = lazyOf(path);
  return render(
    <DemoStoreProvider initialRole={role}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path={path}
            element={
              <Suspense fallback={<div>جاري التحميل...</div>}>
                <Comp />
              </Suspense>
            }
          />
        </Routes>
      </MemoryRouter>
    </DemoStoreProvider>,
  );
}

describe("route smoke test", () => {
  const staticRoutes = ROUTES.filter((r) => !r.path.includes(":"));

  it("all required groups are represented in the registry", () => {
    const groups = new Set(ROUTES.map((r) => r.group));
    for (const expected of [
      "access",
      "dashboards",
      "warehouse",
      "production",
      "quality",
      "management",
      "migration",
      "traceability",
      "reports",
      "admin",
    ] as const) {
      expect(groups.has(expected)).toBe(true);
    }
  });

  it("every role has at least one route", () => {
    for (const r of ROLES) {
      const count = ROUTES.filter((route) => route.roles.includes(r.id)).length;
      expect(count).toBeGreaterThan(0);
    }
  });

  it.each(staticRoutes.map((r) => [r.path, r.labelAr, r.roles[0]] as const))(
    "renders %s (%s) for role %s without throwing",
    async (path, _label, role) => {
      const { container } = renderRoute(path, role as Role);
      // Wait for any lazy load to resolve.
      await new Promise((r) => setTimeout(r, 50));
      expect(container.firstChild).not.toBeNull();
      // The container should have some text content (not be empty).
      expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
    },
  );
});
