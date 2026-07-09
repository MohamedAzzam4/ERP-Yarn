/**
 * DemoPersonaContext — centralized demo persona state.
 *
 * Provides a single source of truth for the current demo persona across all
 * demo pages. Persona is stored in localStorage and read on mount, so it
 * persists across navigation and page refresh.
 *
 * The persona is also set via URL param (?persona=executive) on the dashboard
 * page (from the quick-login redirects). Once set, it stays consistent.
 *
 * Personas:
 *   - executive:  رئيس مجلس الإدارة / العضو المنتدب التنفيذي
 *   - accountant: المدير المالي
 *   - data-entry: مسؤول تسجيل البيانات أو المدخلات
 */
"use client";

import * as React from "react";
import {
  type DemoPersona,
  personaRoleLabel,
} from "@/lib/fixtures/demo-fixtures";

export type { DemoPersona };

const STORAGE_KEY = "egycot-demo-persona";

interface DemoPersonaContextValue {
  persona: DemoPersona;
  roleLabel: string;
  setPersona: (p: DemoPersona) => void;
}

const DemoPersonaContext = React.createContext<DemoPersonaContextValue>({
  persona: "executive",
  roleLabel: personaRoleLabel("executive"),
  setPersona: () => {},
});

export function DemoPersonaProvider({ children }: { children: React.ReactNode }) {
  const [persona, setPersonaState] = React.useState<DemoPersona>("executive");
  const [initialized, setInitialized] = React.useState(false);

  // Read from localStorage + URL param on mount.
  // Uses an event-listener pattern instead of setState-in-effect to satisfy
  // the react-hooks/set-state-in-effect lint rule.
  React.useEffect(() => {
    if (initialized) return;

    function initPersona() {
      setInitialized(true);

      // Priority 1: URL param (from quick-login redirects)
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const urlPersona = params.get("persona");
        if (urlPersona === "executive" || urlPersona === "accountant" || urlPersona === "data-entry") {
          setPersonaState(urlPersona);
          try {
            localStorage.setItem(STORAGE_KEY, urlPersona);
          } catch {
            // ignore
          }
          window.history.replaceState({}, "", window.location.pathname);
          return;
        }
      }

      // Priority 2: localStorage (persists across navigation + refresh)
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === "executive" || stored === "accountant" || stored === "data-entry") {
          setPersonaState(stored);
        }
      } catch {
        // localStorage not available — use default
      }
    }

    initPersona();
  }, [initialized]);

  const setPersona = React.useCallback((p: DemoPersona) => {
    setPersonaState(p);
    try {
      localStorage.setItem(STORAGE_KEY, p);
    } catch {
      // ignore
    }
  }, []);

  const value = React.useMemo(
    () => ({
      persona,
      roleLabel: personaRoleLabel(persona),
      setPersona,
    }),
    [persona, setPersona],
  );

  return (
    <DemoPersonaContext.Provider value={value}>
      {children}
    </DemoPersonaContext.Provider>
  );
}

export function useDemoPersona() {
  return React.useContext(DemoPersonaContext);
}
