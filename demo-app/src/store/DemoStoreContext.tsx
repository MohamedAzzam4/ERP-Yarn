/**
 * Quick Interactive ERP Showcase — central demo store.
 *
 * IMPORTANT: This is NOT a database, audit log, or backup. localStorage is
 * used only so the showcase keeps its UI state between refreshes during a
 * single demo session. The store is disposable and can be reset to seed data
 * at any time via `إعادة ضبط بيانات العرض`.
 *
 * State transitions are UI-only and do NOT claim accounting correctness,
 * immutable ledger posting, or transactional integrity.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type { ActivityEntry, ApprovalItem, DemoState, ReturnRecord, Role } from "@/types";
import { buildSeedState, SEED_VERSION } from "@/data/seed";
import { nextCode, todayIso, uid } from "@/lib/utils";

const STORAGE_KEY = "quick-interactive-erp-showcase:v1";

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type Action =
  | { type: "HYDRATE"; payload: DemoState }
  | { type: "RESET" }
  | { type: "SET_ROLE"; payload: Role }
  | {
      type: "ADVANCE_STORY";
      payload: { step: keyof DemoState["storyProgress"]; entries?: ActivityEntry[] };
    }
  | { type: "ADD_APPROVAL"; payload: ApprovalItem }
  | {
      type: "UPDATE_APPROVAL";
      payload: { id: string; status: ApprovalItem["status"]; reasonAr?: string };
    }
  | { type: "ADD_RETURN"; payload: ReturnRecord }
  | { type: "ADD_ACTIVITY"; payload: ActivityEntry }
  | {
      type: "RAW_RECEIPT_DEMO";
      payload: { code: string; supplierName: string; quantityKg: number; location: string };
    }
  | {
      type: "TRANSFER_DEMO";
      payload: { code: string; quantityKg: number; fromLoc: string; toLoc: string };
    }
  | { type: "ISSUE_DEMO"; payload: { code: string; quantityKg: number; factory: string } }
  | {
      type: "OUTPUT_DEMO";
      payload: { code: string; quantityKg: number; factory: string; lotType: "single" | "twisted" };
    }
  | { type: "SALE_DRAFT_DEMO"; payload: { code: string; customer: string; quantityKg: number } }
  | { type: "SALE_APPROVE_DEMO"; payload: { code: string; approve: boolean; reasonAr?: string } }
  | { type: "PAYMENT_DEMO"; payload: { code: string; amountEgp: number; party: string } };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function reducer(state: DemoState, action: Action): DemoState {
  switch (action.type) {
    case "HYDRATE":
      return action.payload;
    case "RESET":
      return buildSeedState();
    case "SET_ROLE":
      return { ...state, currentRole: action.payload };
    case "ADVANCE_STORY": {
      return {
        ...state,
        storyProgress: {
          ...state.storyProgress,
          [action.payload.step]: true,
        },
        activity: action.payload.entries
          ? [...action.payload.entries, ...state.activity]
          : state.activity,
      };
    }
    case "ADD_APPROVAL":
      return { ...state, approvals: [action.payload, ...state.approvals] };
    case "UPDATE_APPROVAL":
      return {
        ...state,
        approvals: state.approvals.map((a) =>
          a.id === action.payload.id
            ? {
                ...a,
                status: action.payload.status,
                reasonAr: action.payload.reasonAr ?? a.reasonAr,
              }
            : a,
        ),
      };
    case "ADD_RETURN":
      return { ...state, returns: [action.payload, ...state.returns] };
    case "ADD_ACTIVITY":
      return { ...state, activity: [action.payload, ...state.activity] };
    case "RAW_RECEIPT_DEMO":
      return {
        ...state,
        activity: [
          {
            id: uid("act"),
            timestamp: `${todayIso()}T10:00:00`,
            actorAr: "عامل المخزن — أحمد",
            actionAr: `تسجيل استلام رسالة خام ${action.payload.code} (${action.payload.quantityKg} كجم) من ${action.payload.supplierName} في ${action.payload.location}.`,
            category: "warehouse",
            reference: action.payload.code,
          },
          ...state.activity,
        ],
      };
    case "TRANSFER_DEMO":
      return {
        ...state,
        activity: [
          {
            id: uid("act"),
            timestamp: `${todayIso()}T11:00:00`,
            actorAr: "عامل المخزن — أحمد",
            actionAr: `نقل ${action.payload.quantityKg} كجم من ${action.payload.fromLoc} إلى ${action.payload.toLoc} (${action.payload.code}).`,
            category: "warehouse",
            reference: action.payload.code,
          },
          ...state.activity,
        ],
      };
    case "ISSUE_DEMO":
      return {
        ...state,
        activity: [
          {
            id: uid("act"),
            timestamp: `${todayIso()}T12:00:00`,
            actorAr: "عامل الإنتاج — سامي",
            actionAr: `صرف ${action.payload.quantityKg} كجم للإنتاج في ${action.payload.factory} (${action.payload.code}).`,
            category: "production",
            reference: action.payload.code,
          },
          ...state.activity,
        ],
      };
    case "OUTPUT_DEMO":
      return {
        ...state,
        activity: [
          {
            id: uid("act"),
            timestamp: `${todayIso()}T14:00:00`,
            actorAr: "عامل الإنتاج — سامي",
            actionAr: `استلام ${action.payload.lotType === "single" ? "إنتاج فرد" : "إنتاج زوى"} ${action.payload.code} بكمية ${action.payload.quantityKg} كجم من ${action.payload.factory}.`,
            category: "production",
            reference: action.payload.code,
          },
          ...state.activity,
        ],
      };
    case "SALE_DRAFT_DEMO":
      return {
        ...state,
        activity: [
          {
            id: uid("act"),
            timestamp: `${todayIso()}T15:00:00`,
            actorAr: "المحاسب — منى",
            actionAr: `إنشاء مسودة بيع ${action.payload.code} للعميل ${action.payload.customer} بكمية ${action.payload.quantityKg} كجم مع حجز مخزون.`,
            category: "sales",
            reference: action.payload.code,
          },
          ...state.activity,
        ],
      };
    case "SALE_APPROVE_DEMO": {
      const entries = [
        {
          id: uid("act"),
          timestamp: `${todayIso()}T16:00:00`,
          actorAr: action.payload.approve ? "المالك — محمد عبد الله" : "المحاسب — منى",
          actionAr: action.payload.approve
            ? `اعتماد بيع ${action.payload.code} — استهلاك الحجز وترحيل الكمية.`
            : `رفض بيع ${action.payload.code} — السبب: ${action.payload.reasonAr ?? "غير محدد"}.`,
          category: "approval" as const,
          reference: action.payload.code,
        },
      ];
      return {
        ...state,
        activity: [...entries, ...state.activity],
      };
    }
    case "PAYMENT_DEMO":
      return {
        ...state,
        activity: [
          {
            id: uid("act"),
            timestamp: `${todayIso()}T17:00:00`,
            actorAr: "المحاسب — منى",
            actionAr: `تسجيل دفعة ${action.payload.code} بقيمة ${action.payload.amountEgp.toLocaleString("en-US")} جنيه من/إلى ${action.payload.party}.`,
            category: "payment",
            reference: action.payload.code,
          },
          ...state.activity,
        ],
      };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function loadFromStorage(): DemoState {
  if (typeof window === "undefined") return buildSeedState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildSeedState();
    const parsed = JSON.parse(raw) as DemoState;
    if (parsed.version !== SEED_VERSION) return buildSeedState();
    return parsed;
  } catch {
    return buildSeedState();
  }
}

function saveToStorage(state: DemoState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota or privacy mode — silently ignore. The showcase remains usable.
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface DemoStoreContextValue {
  state: DemoState;
  dispatch: React.Dispatch<Action>;
  reset: () => void;
  setRole: (role: Role) => void;
  /** Advance the coherent demo story by one step. */
  advanceStory: (
    step: keyof DemoState["storyProgress"],
    extra?: { activity?: ActivityEntry[] },
  ) => void;
  /** Generate the next sequential code in a given prefix. */
  nextShowcaseCode: (prefix: string) => string;
}

const DemoStoreContext = createContext<DemoStoreContextValue | null>(null);

export interface DemoStoreProviderProps {
  children: ReactNode;
  /** Optional initial role override (useful for tests). */
  initialRole?: Role;
}

export function DemoStoreProvider({ children, initialRole }: DemoStoreProviderProps) {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const s = loadFromStorage();
    if (initialRole) s.currentRole = initialRole;
    return s;
  });

  useEffect(() => {
    saveToStorage(state);
  }, [state]);

  const reset = useCallback(() => dispatch({ type: "RESET" }), []);
  const setRole = useCallback((role: Role) => dispatch({ type: "SET_ROLE", payload: role }), []);

  const advanceStory = useCallback(
    (step: keyof DemoState["storyProgress"], extra?: { activity?: ActivityEntry[] }) =>
      dispatch({ type: "ADVANCE_STORY", payload: { step, entries: extra?.activity } }),
    [],
  );

  const nextShowcaseCode = useCallback(
    (prefix: string) => {
      const year = 2026;
      const existing =
        prefix === "RB"
          ? state.rawBatches.map((b) => b.code)
          : prefix === "TR"
            ? state.movements.filter((m) => m.type === "transfer").map((m) => m.reference ?? "")
            : prefix === "PO"
              ? state.productionOrders.map((p) => p.code)
              : prefix === "LOT-S"
                ? state.yarnLots.filter((l) => l.category === "single_yarn").map((l) => l.code)
                : prefix === "LOT-T"
                  ? state.yarnLots.filter((l) => l.category === "twisted_yarn").map((l) => l.code)
                  : prefix === "SAL"
                    ? state.sales.map((s) => s.code)
                    : prefix === "PAY"
                      ? state.payments.map((p) => p.code)
                      : prefix === "RET"
                        ? state.returns.map((r) => r.code)
                        : state.approvals.map((a) => a.reference);
      return nextCode(prefix, year, existing);
    },
    [state],
  );

  const value = useMemo<DemoStoreContextValue>(
    () => ({ state, dispatch, reset, setRole, advanceStory, nextShowcaseCode }),
    [state, reset, setRole, advanceStory, nextShowcaseCode],
  );

  return <DemoStoreContext.Provider value={value}>{children}</DemoStoreContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDemoStore(): DemoStoreContextValue {
  const ctx = useContext(DemoStoreContext);
  if (!ctx) throw new Error("useDemoStore must be used within <DemoStoreProvider>");
  return ctx;
}
