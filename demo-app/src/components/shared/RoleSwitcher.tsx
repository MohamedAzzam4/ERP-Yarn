import { UserCircle2 } from "lucide-react";
import { useDemoStore } from "@/store/DemoStoreContext";
import { ROLES, type Role } from "@/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Demo role switcher. Mirrors §8 of the showcase prompt: a presentation aid,
 * NOT authentication. The role lives only in client-side demo state.
 */
export interface RoleSwitcherProps {
  className?: string;
  /** Hide the icon (for compact placements). */
  compact?: boolean;
}

export function RoleSwitcher({ className, compact = false }: RoleSwitcherProps) {
  const { state, setRole } = useDemoStore();

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {!compact ? <UserCircle2 className="h-5 w-5 text-muted-foreground" aria-hidden /> : null}
      <label htmlFor="role-switcher" className="sr-only">
        تبديل دور العرض التفاعلي
      </label>
      <Select value={state.currentRole} onValueChange={(v) => setRole(v as Role)}>
        <SelectTrigger id="role-switcher" className="w-[220px]" aria-label="تبديل دور العرض">
          <SelectValue placeholder="اختر الدور" />
        </SelectTrigger>
        <SelectContent>
          {ROLES.map((r) => (
            <SelectItem key={r.id} value={r.id}>
              <span className="font-medium">{r.labelAr}</span>
              <span className="ms-2 text-xs text-muted-foreground">— {r.labelEn}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
