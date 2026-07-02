/**
 * Shared MasterDataListPage component — renders a clean list page for any
 * master-data entity type with an explicit empty state.
 *
 * WP-02-01: Used by customers, locations, factories, fiber-types,
 * product-types, and quality-parameters pages. The suppliers page has
 * its own implementation with a real DB read; these pages show an empty
 * state until their DB reads are wired (they do NOT render fixture data).
 *
 * WP-01-08 approved UI baseline: Arabic RTL, Calm Enterprise, 44px touch
 * targets, no glass on data, accessible focus states.
 */
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export interface MasterDataListPageProps {
  titleAr: string;
  descriptionAr: string;
  addLabelAr: string;
  emptyTitleAr: string;
  emptyDescriptionAr: string;
}

export function MasterDataListPage({
  titleAr,
  descriptionAr,
  addLabelAr,
  emptyTitleAr,
  emptyDescriptionAr,
}: MasterDataListPageProps) {
  return (
    <Container size="xl" className="py-6">
      <div className="mb-6 rounded-2xl border border-primary/20 bg-gradient-to-l from-primary/12 via-primary/5 to-transparent p-5 backdrop-blur-md shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="inline-block h-7 w-1.5 rounded-full bg-primary" aria-hidden="true" />
            <div>
              <h1 className="text-heading-2 text-foreground">{titleAr}</h1>
              <p className="text-sm text-muted-foreground">{descriptionAr}</p>
            </div>
          </div>
          <Button type="button" variant="primary" className="min-h-[44px]" aria-label={addLabelAr}>
            {addLabelAr}
          </Button>
        </div>
      </div>
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-heading-4 text-foreground">القائمة</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <line x1="20" y1="8" x2="20" y2="14" />
                <line x1="23" y1="11" x2="17" y2="11" />
              </svg>
            </div>
            <p className="text-sm font-medium text-foreground">{emptyTitleAr}</p>
            <p className="text-xs text-muted-foreground mt-1">{emptyDescriptionAr}</p>
          </div>
          <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border">هذه شاشة إدارية — يتم تطبيق صلاحيات المالك/المحاسب فقط</p>
        </CardContent>
      </Card>
    </Container>
  );
}
