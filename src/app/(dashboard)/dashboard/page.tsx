import { Metadata } from "next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { pagePermission } from "@/lib/auth/page-guards";
import { ROLE_LABELS } from "@/components/layout/nav-config";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Role-scoped dashboard (Phase 1 shell).
 * Numbers are intentionally NOT hardcoded — Phase 3 replaces this card grid
 * with real aggregates from the reports service (FR10 forbids demo numbers).
 */
export default async function DashboardPage() {
  const session = await pagePermission("dashboard", "read");
  const role = session.user.role;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {ROLE_LABELS[role]} view · data loads in Phase 3
          </p>
        </div>
        <Badge variant="outline">{ROLE_LABELS[role]}</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {[
          { title: "Employees", hint: "Headcount by status" },
          { title: "Departments", hint: "With employee counts" },
          { title: "Attendance today", hint: "Present / absent / remote" },
          { title: "Leave requests", hint: "Pending approvals" },
          { title: "Payroll", hint: "Current period totals" },
          { title: "Attrition risk", hint: "Risk category split" },
        ].map((card) => (
          <Card key={card.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold text-slate-400">—</p>
              <p className="mt-1 text-xs text-muted-foreground">{card.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>
            Audit events will appear here once HR modules are active.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="py-6 text-center text-sm text-muted-foreground">
            No activity to display yet.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
