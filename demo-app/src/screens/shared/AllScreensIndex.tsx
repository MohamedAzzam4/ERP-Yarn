import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { ROUTES, ROUTE_GROUPS } from "@/routes";

export default function AllScreensIndex() {
  const groups = Object.keys(ROUTE_GROUPS) as (keyof typeof ROUTE_GROUPS)[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="عرض جميع الشاشات"
        description="فهرس شامل لكل شاشات العرض التفاعلي للمالك. اضغط أي بطاقة للوصول إلى الشاشة مباشرة."
      />
      {groups.map((groupKey) => {
        const items = ROUTES.filter((r) => r.group === groupKey);
        if (items.length === 0) return null;
        return (
          <section key={groupKey} className="space-y-3">
            <h2 className="font-heading text-lg font-semibold text-foreground">
              {ROUTE_GROUPS[groupKey]}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((r) => (
                <Link
                  key={r.path}
                  to={r.path}
                  className="group flex items-start justify-between gap-3 rounded-lg border border-border bg-surface p-4 shadow-card transition-all hover:border-accent hover:shadow-elevated"
                >
                  <div className="space-y-1">
                    <p className="font-heading text-sm font-semibold text-foreground">
                      {r.labelAr}
                    </p>
                    {r.descriptionAr ? (
                      <p className="text-xs text-muted-foreground" dir="rtl">
                        {r.descriptionAr}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      <bdi dir="ltr">{r.path}</bdi>
                    </p>
                  </div>
                  <ExternalLink
                    className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-accent"
                    aria-hidden
                  />
                </Link>
              ))}
            </div>
          </section>
        );
      })}
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          العدد الإجمالي للشاشات: <bdi dir="ltr">{ROUTES.length}</bdi> شاشة.
        </CardContent>
      </Card>
    </div>
  );
}
