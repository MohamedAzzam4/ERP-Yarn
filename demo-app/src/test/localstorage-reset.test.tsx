import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { DemoStoreProvider, useDemoStore } from "@/store/DemoStoreContext";
import { buildSeedState, SEED_VERSION } from "@/data/seed";

function Probe() {
  const { state, reset, setRole } = useDemoStore();
  return (
    <div>
      <div data-testid="role">{state.currentRole}</div>
      <div data-testid="raw-batch-count">{state.rawBatches.length}</div>
      <div data-testid="version">{state.version}</div>
      <button onClick={() => setRole("warehouse")}>set-warehouse</button>
      <button onClick={() => reset()}>reset</button>
    </div>
  );
}

describe("localStorage persistence and reset", () => {
  it("seed state matches SEED_VERSION and has expected seed data", () => {
    const seed = buildSeedState();
    expect(seed.version).toBe(SEED_VERSION);
    expect(seed.rawBatches.length).toBeGreaterThan(0);
    expect(seed.currentRole).toBe("owner");
    expect(seed.storyProgress.step1_rawReceipt).toBe(false);
  });

  it("DemoStoreProvider initializes from seed when localStorage is empty", () => {
    window.localStorage.clear();
    render(
      <DemoStoreProvider>
        <Probe />
      </DemoStoreProvider>,
    );
    expect(screen.getByTestId("role").textContent).toBe("owner");
    expect(screen.getByTestId("raw-batch-count").textContent).toBe(
      String(buildSeedState().rawBatches.length),
    );
  });

  it("role change persists to localStorage and survives remount", () => {
    const { unmount } = render(
      <DemoStoreProvider>
        <Probe />
      </DemoStoreProvider>,
    );
    act(() => {
      screen.getByText("set-warehouse").click();
    });
    expect(screen.getByTestId("role").textContent).toBe("warehouse");

    // Persisted value should be in localStorage.
    const raw = window.localStorage.getItem("quick-interactive-erp-showcase:v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.currentRole).toBe("warehouse");

    unmount();

    // Remount — should hydrate from localStorage.
    render(
      <DemoStoreProvider>
        <Probe />
      </DemoStoreProvider>,
    );
    expect(screen.getByTestId("role").textContent).toBe("warehouse");
  });

  it("reset restores deterministic seed data", () => {
    render(
      <DemoStoreProvider>
        <Probe />
      </DemoStoreProvider>,
    );
    // Change role first.
    act(() => {
      screen.getByText("set-warehouse").click();
    });
    expect(screen.getByTestId("role").textContent).toBe("warehouse");

    // Reset.
    act(() => {
      screen.getByText("reset").click();
    });
    expect(screen.getByTestId("role").textContent).toBe("owner");
    expect(screen.getByTestId("raw-batch-count").textContent).toBe(
      String(buildSeedState().rawBatches.length),
    );

    // Reset also writes to localStorage.
    const raw = window.localStorage.getItem("quick-interactive-erp-showcase:v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.currentRole).toBe("owner");
  });

  it("corrupt localStorage falls back to seed", () => {
    window.localStorage.setItem("quick-interactive-erp-showcase:v1", "{not valid json");
    render(
      <DemoStoreProvider>
        <Probe />
      </DemoStoreProvider>,
    );
    expect(screen.getByTestId("role").textContent).toBe("owner");
  });

  it("version mismatch falls back to seed", () => {
    const stale = buildSeedState();
    stale.version = 999;
    window.localStorage.setItem("quick-interactive-erp-showcase:v1", JSON.stringify(stale));
    render(
      <DemoStoreProvider>
        <Probe />
      </DemoStoreProvider>,
    );
    expect(screen.getByTestId("version").textContent).toBe(String(SEED_VERSION));
  });
});
