import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";

/** Consistent page header (title + description + optional actions slot). */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * Phase-boundary placeholder: route + guard exist, module lands in a later
 * phase. Never ships to production (Phase gates remove every instance).
 */
export function ModuleShell({
  phase,
  scope,
}: {
  phase: string;
  scope: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
        <Construction className="size-8 text-muted-foreground" aria-hidden />
        <p className="font-medium">Module scheduled for {phase}</p>
        <p className="max-w-md text-sm text-muted-foreground">{scope}</p>
      </CardContent>
    </Card>
  );
}
