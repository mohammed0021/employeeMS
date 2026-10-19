import { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download } from "lucide-react";
import { pagePermissionAny, pageService } from "@/lib/auth/page-guards";
import { can } from "@/lib/auth/permissions";
import { employeeScopeFrom } from "@/lib/services/actor";
import { computeOwnSummary, computeSummary } from "@/lib/services/reports";
import { toUrlSearchParams } from "@/lib/pagination";
import { reportRangeSchema, type ReportExportKind } from "@/lib/validation/reports";

export const metadata: Metadata = { title: "Reports" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const EXPORT_KINDS: Array<{ kind: ReportExportKind; label: string }> = [
  { kind: "headcount", label: "Headcount CSV" },
  { kind: "attendance", label: "Attendance CSV" },
  { kind: "leave", label: "Leave CSV" },
  { kind: "payroll", label: "Payroll CSV" },
];

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

/** GET form with the only two params this page has — no carries needed. */
function RangeForm({ from, to }: { from: string; to: string }) {
  return (
    <form action="/reports" method="get" className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="rep-from" className="text-xs text-muted-foreground">
          From
        </Label>
        <Input
          id="rep-from"
          name="from"
          type="date"
          defaultValue={from}
          className="h-8 w-[150px]"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="rep-to" className="text-xs text-muted-foreground">
          To
        </Label>
        <Input
          id="rep-to"
          name="to"
          type="date"
          defaultValue={to}
          className="h-8 w-[150px]"
        />
      </div>
      <Button type="submit" variant="outline" size="sm">
        Apply range
      </Button>
      <Button render={<Link href="/reports" />} variant="ghost" size="sm">
        Reset to last 30 days
      </Button>
    </form>
  );
}

export default async function ReportsPage({ searchParams }: PageProps) {
  // ADMIN/HR read org-wide; EMPLOYEE reads only their own summary (readOwn).
  const session = await pagePermissionAny("reports", "read", "readOwn");
  const { role } = session.user;
  const isOrgWide = can(role, "reports", "read");

  const params = toUrlSearchParams(await searchParams);
  // Blank or absent dates mean "default to the last 30 days" inside the
  // service. A hand-mangled ?from= also falls back to that default rather
  // than crashing the page — the resolved range is shown below regardless.
  const parsed = reportRangeSchema.safeParse({
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
  });
  const range = parsed.success ? parsed.data : {};
  const actor = employeeScopeFrom(session);

  // Every figure below comes from counted/aggregated DB queries — nothing is
  // estimated. The service scopes EMPLOYEE rows to the session's employee.
  if (!isOrgWide) {
    const own = await pageService(() => computeOwnSummary(range, actor));
    return (
      <div className="space-y-6">
        <PageHeader
          title="My reports"
          description="Your own attendance, leave and payroll for the selected range."
        />

        <RangeForm from={own.range.from} to={own.range.to} />
        <p className="text-sm text-muted-foreground">
          Showing {own.range.from} → {own.range.to}
        </p>

        <div className="grid gap-4 md:grid-cols-3">
          <StatCard
            label="Attendance"
            value={own.attendance.records}
            sub={
              <>
                {own.attendance.present} present · {own.attendance.absent} absent ·{" "}
                {own.attendance.remote} remote · {own.attendance.halfDay} half-day
                <br />
                {own.attendance.totalHours} h logged
              </>
            }
          />
          <StatCard
            label="Leave approved"
            value={own.leave.approved}
            sub={`${own.leave.pending} pending · ${own.leave.takenDays} day${
              own.leave.takenDays === 1 ? "" : "s"
            } taken`}
          />
          <StatCard
            label="Payroll net"
            value={own.payroll.netTotal}
            sub={`${own.payroll.months} payslip${own.payroll.months === 1 ? "" : "s"} in range`}
          />
        </div>
      </div>
    );
  }

  const org = await pageService(() => computeSummary(range, actor));
  const maxDepartmentCount = Math.max(
    1,
    ...org.headcount.byDepartment.map((d) => d.count),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Overview aggregates from real records — headcount is a current snapshot; attendance, leave and payroll cover the selected range."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {EXPORT_KINDS.map(({ kind, label }) => (
              <Button
                key={kind}
                render={
                  <Link
                    href={`/api/reports/export?kind=${kind}&from=${org.range.from}&to=${org.range.to}`}
                  />
                }
                variant="outline"
                size="sm"
              >
                <Download className="size-4" aria-hidden />
                {label}
              </Button>
            ))}
          </div>
        }
      />

      <RangeForm from={org.range.from} to={org.range.to} />
      <p className="text-sm text-muted-foreground">
        Showing {org.range.from} → {org.range.to} · generated{" "}
        {new Date(org.generatedAt).toLocaleString()}
      </p>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Headcount"
          value={org.headcount.total}
          sub={`${org.headcount.active} active · ${org.headcount.onLeave} on leave · ${org.headcount.inactive} inactive`}
        />
        <StatCard
          label="Attendance rate"
          // The service returns a 2dp ratio (0..1); percent is the same
          // number in familiar units, not a new figure.
          value={`${Math.round(Number(org.attendance.attendanceRate) * 100)}%`}
          sub={`${org.attendance.records} records · ${org.attendance.present} present · ${org.attendance.absent} absent`}
        />
        <StatCard
          label="Leave pending"
          value={org.leave.pending}
          sub={`${org.leave.pendingDays} pending day${org.leave.pendingDays === 1 ? "" : "s"} · ${org.leave.approved} approved`}
        />
        <StatCard
          label="Payroll net total"
          value={org.payroll.netTotal}
          sub={`${org.payroll.records} records created in range (${org.range.from} → ${org.range.to})`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <h2 className="font-medium">Headcount by department</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              Current snapshot of the roster.
            </p>
            {org.headcount.byDepartment.length === 0 ? (
              <p className="text-sm text-muted-foreground">No departments yet.</p>
            ) : (
              <div className="space-y-3">
                {[...org.headcount.byDepartment]
                  .sort((a, b) => b.count - a.count)
                  .map((department) => (
                    <div key={department.id} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 truncate text-sm">
                        {department.name}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{
                            width: `${(department.count / maxDepartmentCount) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right text-sm tabular-nums">
                        {department.count}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <h2 className="font-medium">Payroll by month</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              Exact decimal sums of net pay, per month, in range.
            </p>
            {org.payroll.byMonth.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No payroll records in this range.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {org.payroll.byMonth.map((month) => (
                  <li
                    key={`${month.year}-${month.month}`}
                    className="flex items-center justify-between border-b pb-2 last:border-0"
                  >
                    <span className="tabular-nums">
                      {String(month.month).padStart(2, "0")}/{month.year}
                    </span>
                    <span className="tabular-nums">{month.netTotal}</span>
                    <span className="text-muted-foreground">
                      {month.records} record{month.records === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
