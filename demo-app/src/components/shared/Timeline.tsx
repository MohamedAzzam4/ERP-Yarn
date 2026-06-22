import { cn } from "@/lib/utils";
import { BidiValue } from "./BidiValue";

export interface TimelineEvent {
  id: string;
  date: string;
  titleAr: string;
  descriptionAr: string;
  reference?: string;
  quantityKg?: number;
}

export interface TimelineProps {
  events: TimelineEvent[];
  emptyMessage?: string;
  className?: string;
}

export function Timeline({ events, emptyMessage = "لا توجد أحداث.", className }: TimelineProps) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }
  return (
    <ol className={cn("space-y-3", className)} aria-label="الخط الزمني للأحداث">
      {events.map((event, idx) => (
        <li key={event.id} className="relative flex gap-3 ps-6">
          <span
            className="absolute start-0 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-foreground"
            aria-hidden
          >
            <span className="block h-1.5 w-1.5 rounded-full bg-accent-foreground" />
          </span>
          {idx < events.length - 1 ? (
            <span className="absolute start-[7px] top-6 h-full w-px bg-border" aria-hidden />
          ) : null}
          <div className="flex-1 space-y-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-heading text-sm font-semibold text-foreground">
                {event.titleAr}
              </span>
              <BidiValue size="xs" className="text-muted-foreground">
                {event.date}
              </BidiValue>
              {event.reference ? (
                <BidiValue
                  size="xs"
                  className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground"
                >
                  {event.reference}
                </BidiValue>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground" dir="rtl">
              {event.descriptionAr}
              {event.quantityKg !== undefined ? (
                <>
                  {" — الكمية: "}
                  <BidiValue size="sm" numeric>
                    {event.quantityKg.toLocaleString("en-US")}
                  </BidiValue>
                  {" كجم."}
                </>
              ) : null}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
