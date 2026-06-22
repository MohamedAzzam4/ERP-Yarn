import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useEffect } from "react";
import { DemoStoreProvider, useDemoStore } from "@/store/DemoStoreContext";
import OwnerDashboard from "@/screens/dashboards/OwnerDashboard";
import AccountantDashboard from "@/screens/dashboards/AccountantDashboard";
import InventoryBalances from "@/screens/management/InventoryBalances";
import SalesList from "@/screens/management/SalesList";
import ProductionOrders from "@/screens/management/ProductionOrders";
import type { Role } from "@/types";

function RoleSetter({ role }: { role: Role }) {
  const { setRole } = useDemoStore();
  useEffect(() => {
    setRole(role);
  }, [role, setRole]);
  return null;
}

function renderWithRole(role: Role, element: React.ReactNode) {
  return render(
    <DemoStoreProvider>
      <RoleSetter role={role} />
      <MemoryRouter>{element}</MemoryRouter>
    </DemoStoreProvider>,
  );
}

describe("role navigation + worker financial redaction", () => {
  it("owner dashboard shows profitability KPI for owner", () => {
    renderWithRole("owner", <OwnerDashboard />);
    expect(screen.getByText(/الربح التقريبي المعتمد/)).toBeInTheDocument();
  });

  it("owner dashboard shows balance amounts (financial visible)", () => {
    const { container } = renderWithRole("owner", <OwnerDashboard />);
    expect(container.textContent).toContain("جنيه");
  });

  it("accountant dashboard shows review queue and missing-price warnings", () => {
    renderWithRole("accountant", <AccountantDashboard />);
    expect(screen.getByText(/قائمة المراجعة الموحّدة/)).toBeInTheDocument();
    expect(screen.getByText(/رسائل خام بانتظار إثبات السعر/)).toBeInTheDocument();
  });

  it("inventory balances hide financial value column for warehouse worker", () => {
    const { container } = renderWithRole("warehouse", <InventoryBalances />);
    expect(container.textContent).not.toContain("القيمة التقديرية");
  });

  it("inventory balances show financial value column for owner", () => {
    const { container } = renderWithRole("owner", <InventoryBalances />);
    expect(container.textContent).toContain("القيمة التقديرية");
  });

  it("sales list hides profit column for warehouse worker", () => {
    const { container } = renderWithRole("warehouse", <SalesList />);
    expect(container.textContent).not.toContain("الإيراد الصافي");
    expect(container.textContent).not.toContain("الربح التقريبي");
  });

  it("sales list shows profit columns for accountant", () => {
    const { container } = renderWithRole("accountant", <SalesList />);
    expect(container.textContent).toContain("الإيراد الصافي");
    expect(container.textContent).toContain("الربح التقريبي");
  });

  it("production orders hide payable column for production worker", () => {
    const { container } = renderWithRole("production", <ProductionOrders />);
    expect(container.textContent).not.toContain("المستحق");
  });

  it("production orders show payable column for accountant", () => {
    const { container } = renderWithRole("accountant", <ProductionOrders />);
    expect(container.textContent).toContain("المستحق");
  });
});
