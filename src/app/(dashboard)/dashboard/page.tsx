import { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { pagePermission, pageService } from "@/lib/auth/page-guards";
import { can } from "@/lib/auth/permissions";
import { actorFrom, employeeScopeFrom } from "@/lib/services/actor";
import {
  computeOwnSummary,
  computeSummary,
  type OwnReportSummary,
  type ReportSummary,
} from "@/lib/services/reports";
import { listAuditLogs } from "@/lib/services/audit-log";
import { attritionActorFrom, listSignals } from "@/lib/services/attrition";
import { parseListQuery } from "@/lib/pagination";
import {
  parseAttritionListQuery,
  RISK_CATEGORIES,
} from "@/lib/validation/attrition";
import { ROLE_LABELS } from "@/components/layout/nav-config";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Role-scoped dashboard.
 *
 * Every figure is read from a service at request time — this page never
 * fabricates, rounds or hardcodes a number (FR10: administrators monitor the
 * system through real aggregates, not demo values).
 *
 * The page assembles exactly what the caller is permitted to see:
 *  - ADMIN/HR → org-wide `computeSummary` (reports `read`).
 *  - EMPLOYEE → self-scoped `computeOwnSummary` (reports `readOwn`); the
 *    service restricts rows to `actor.employeeId`, so scoping never lives
 *    only in this UI.
 *  - Recent audit activity only where the matrix grants `audit` read (ADMIN).
 *  - Attrition split only where the matrix grants `attrition` read (ADMIN/HR).
 *
 * The range shown is the reports service default (last 30 days inclusive) and
 * is printed on screen so the window behind every number is explicit.
 *
 * The two summary shapes are deliberately kept in separate variables: the
 * org-wide and self-scoped DTOs are different types, and collapsing them into
 * one would silently allow `headcount` on an employee's own dashboard.
 */

function StatCard({
  title,
  value,
  hint,
  children,
}: {
  title: string;
  value: ReactNode;
  hint: string;
  children?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        {children}
      </CardContent>
    </Card>
  );
}

/** ISO instant → `YYYY-MM-DD HH:mm` (UTC) — stable in tests and screenshots. */
function stamp(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

type RiskCounts = Array<{ category: (typeof RISK_CATEGORIES)[number]; total: number }>;

export default async function DashboardPage() {
  const session = await pagePermission("dashboard", "read");
  const role = session.user.role;
  const isOrgWide = can(role, "reports", "read");
  const actor = employeeScopeFrom(session);

  // Exactly one of the two is ever fetched — the matrix decides, the service
  // re-checks, and pageService turns a service AppError into a 403/404 page.
  const orgSummary: ReportSummary | null = isOrgWide
    ? await pageService(() => computeSummary({}, actor))
    : null;
  const ownSummary: OwnReportSummary | null = isOrgWide
    ? null
    : await pageService(() => computeOwnSummary({}, actor));

  const showAudit = can(role, "audit", "read");
  const showAttrition = can(role, "attrition", "read");

  const [activity, risk] = await Promise.all([
    showAudit
      ? pageService(() =>
          listAuditLogs(
            parseListQuery(new URLSearchParams({ limit: "5" })),
            {},
            actorFrom(session),
          ),
        )
      : null,
    showAttrition
      ? Promise.all(
          RISK_CATEGORIES.map(async (category) => {
            const { query, filters } = parseAttritionListQuery(
              new URLSearchParams({ category, limit: "1" }),
            );
            const page = await listSignals(
              query,
              filters,
              attritionActorFrom(session),
            );
            return { category, total: page.total };
          }),
        )
      : null,
  ]);

  const range = (orgSummary ?? ownSummary)?.range;
  const windowLabel = range ? `${range.from} → ${range.to}` : "";

  const riskTotal = (counts: RiskCounts, category: string) =>
    counts.find((entry) => entry.category === category)?.total ?? 0;
  const signalsTotal = risk
    ? risk.reduce((sum, entry) => sum + entry.total, 0)
    : 0;

  const orgContent: ReactNode = orgSummary ? (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <StatCard
          title="Employees"
          value={orgSummary.headcount.total}
          hint={`${orgSummary.headcount.active} active · ${orgSummary.headcount.onLeave} on leave · ${orgSummary.headcount.inactive} inactive`}
        />
        <StatCard
          title="Departments"
          value={orgSummary.headcount.byDepartment.length}
          hint={
            orgSummary.headcount.byDepartment[0]
              ? `Largest: ${orgSummary.headcount.byDepartment[0].name} (${orgSummary.headcount.byDepartment[0].count})`
              : "No departments yet"
          }
        />
        <StatCard
          title="Attendance"
          value={orgSummary.attendance.present}
          hint={`${orgSummary.attendance.absent} absent · ${orgSummary.attendance.remote} remote · ${
            // The service returns a 2dp ratio (0..1); percent is the same
            // number in familiar units — same conversion the reports page uses.
            Math.round(Number(orgSummary.attendance.attendanceRate) * 100)
          }% on time`}
        />
        <StatCard
          title="Leave requests"
          value={orgSummary.leave.pending}
          hint={`${orgSummary.leave.pendingDays} pending days · ${orgSummary.leave.approved} approved`}
        />
        <StatCard
          title="Payroll"
          value={<span className="text-xl">{orgSummary.payroll.netTotal}</span>}
          hint={`${orgSummary.payroll.records} records · ${orgSummary.payroll.final} finalised`}
        />
        <StatCard
          title="Attrition risk"
          value={
            risk ? (
              riskTotal(risk, "HIGH")
            ) : (
              <span className="text-slate-400">—</span>
            )
          }
          hint={
            !risk
              ? "Model access not granted to your role"
              : signalsTotal === 0
                ? "No signals yet — run the model in attrition analytics"
                : `${riskTotal(risk, "HIGH")} high · ${riskTotal(
                    risk,
                    "MEDIUM",
                  )} medium · ${riskTotal(risk, "LOW")} low`
          }
        >
          <Link
            href="/attrition"
            className="mt-2 inline-block text-xs text-primary hover:underline"
          >
            Open attrition analytics →
          </Link>
        </StatCard>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>
            Latest audited events — every mutation is recorded with its actor,
            action and outcome.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activity && activity.items.length > 0 ? (
            <ul className="divide-y">
              {activity.items.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <span className="font-medium">{event.action}</span>
                  <span className="text-muted-foreground">
                    {event.entityType}
                    {event.actor ? ` · ${event.actor.email}` : " · system"}
                  </span>
                  <Badge
                    variant={
                      event.outcome === "SUCCESS" ? "outline" : "destructive"
                    }
                  >
                    {event.outcome}
                  </Badge>
                  <span className="tabular-nums text-xs text-muted-foreground">
                    {stamp(event.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No audit events recorded yet.
            </p>
          )}
          {activity && activity.total > activity.items.length ? (
            <Link
              href="/audit"
              className="mt-2 inline-block text-xs text-primary hover:underline"
            >
              View all {activity.total} events →
            </Link>
          ) : null}
        </CardContent>
      </Card>
    </>
  ) : null;

  const ownContent: ReactNode = ownSummary ? (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Attendance"
          value={ownSummary.attendance.present}
          hint={`${ownSummary.attendance.absent} absent · ${ownSummary.attendance.remote} remote · ${ownSummary.attendance.halfDay} half day`}
        >
          <p className="mt-2 text-xs text-muted-foreground">
            {ownSummary.attendance.totalHours} recorded hours across{" "}
            {ownSummary.attendance.records} records
          </p>
        </StatCard>
        <StatCard
          title="Leave requests"
          value={ownSummary.leave.pending}
          hint={`${ownSummary.leave.approved} approved · ${ownSummary.leave.total} total`}
        >
          <p className="mt-2 text-xs text-muted-foreground">
            {ownSummary.leave.takenDays} approved days taken
          </p>
        </StatCard>
        <StatCard
          title="Payroll"
          value={<span className="text-xl">{ownSummary.payroll.netTotal}</span>}
          hint={`net across ${ownSummary.payroll.months} months`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick links</CardTitle>
          <CardDescription>Your routes in the system.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 text-sm">
          <Link href="/attendance" className="text-primary hover:underline">
            My attendance →
          </Link>
          <Link href="/leave" className="text-primary hover:underline">
            Request leave →
          </Link>
          <Link href="/payroll" className="text-primary hover:underline">
            My payslips →
          </Link>
          <Link href="/chat" className="text-primary hover:underline">
            HR policy chatbot →
          </Link>
        </CardContent>
      </Card>
    </>
  ) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {ROLE_LABELS[role]} view ·{" "}
            {isOrgWide ? "organisation figures" : "your figures"} ·{" "}
            {windowLabel} (last 30 days)
          </p>
        </div>
        <Badge variant="outline">{ROLE_LABELS[role]}</Badge>
      </div>

      {orgContent ?? ownContent}
    </div>
  );
}
