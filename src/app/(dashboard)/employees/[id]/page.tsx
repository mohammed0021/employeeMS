import { Metadata } from "next";
import Link from "next/link";

import { BackToDirectory, EmployeeDetail } from "@/components/employees/employee-detail";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/auth/permissions";
import { pagePermissionAny, pageService } from "@/lib/auth/page-guards";
import { employeeScopeFrom } from "@/lib/services/actor";
import { getEmployee } from "@/lib/services/employees";
import { listAttendance } from "@/lib/services/attendance";
import { listLeaveRequests } from "@/lib/services/leave";
import { listPayrolls } from "@/lib/services/payroll";
import { toLeaveSort, type LeaveListQuery } from "@/lib/validation/leave";
import type { AttendanceListFilters } from "@/lib/validation/attendance";
import type { PayrollFilters } from "@/lib/validation/payroll";

export const metadata: Metadata = { title: "Employee profile" };

type Props = { params: Promise<{ id: string }> };

export default async function EmployeeDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await pagePermissionAny("employees", "read", "readOwn");

  // The service enforces readOwn scoping; this only decides *which* action the
  // matrix grants so an EMPLOYEE isn't bounced from their own profile.
  const actor = employeeScopeFrom(session);
  // `getEmployee` throws 403 for another employee's record *before* it reveals
  // whether that record exists, so the readOwn rule stays in the service and
  // pageService() turns the throw into the 403 page rather than a 500.
  const employee = await pageService(() => getEmployee(id, actor));

  const { role } = session.user;
  const isOrgWide = can(role, "employees", "read");
  const canUpdate = can(role, "employees", "update");

  // Role-scoped summaries. The services re-scope EMPLOYEE to their own rows,
  // so passing `id` here can never widen what an EMPLOYEE may read.
  // `listLeaveRequests` folds its filters into the query object (no separate
  // filters arg like attendance/payroll), and its sort is narrowed to the
  // allow-list via `toLeaveSort`.
  const leaveQuery: LeaveListQuery = {
    page: 1,
    limit: 5,
    employeeId: id,
  };
  const [attendance, leave, payroll] = await Promise.all([
    listAttendance(
      { page: 1, limit: 5, q: undefined },
      { employeeId: id } satisfies AttendanceListFilters,
      { field: "date", dir: "desc" },
      actor,
    ),
    listLeaveRequests(leaveQuery, toLeaveSort({ field: "submittedAt", dir: "desc" }), actor),
    listPayrolls(
      { page: 1, limit: 5, q: undefined },
      { employeeId: id } satisfies PayrollFilters,
      { field: "year", dir: "desc" },
      actor,
    ),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={employee.fullName}
        description={`${employee.position} · ${employee.department?.name ?? "No department"}`}
        actions={
          <div className="flex items-center gap-2">
            <Button render={<BackToDirectory />} variant="outline" size="sm">
              Back
            </Button>
            {canUpdate ? (
              <Button render={<Link href={`/employees/${employee.id}/edit`} />} size="sm">
                Edit profile
              </Button>
            ) : null}
          </div>
        }
      />

      <EmployeeDetail employee={employee} />

      <div className="grid gap-6 lg:grid-cols-3">
        <SummaryCard
          title="Recent attendance"
          href={isOrgWide ? `/attendance?employeeId=${id}` : "/attendance"}
          empty="No attendance records."
          items={attendance.items.map((r) => {
            const hours =
              r.checkIn && r.checkOut
                ? ((Date.parse(r.checkOut) - Date.parse(r.checkIn)) / 3_600_000).toFixed(2)
                : "—";
            return {
              key: r.id,
              primary: r.date,
              secondary: `${r.status} · ${hours}h`,
            };
          })}
          total={attendance.total}
        />

        <SummaryCard
          title="Recent leave"
          href={isOrgWide ? `/leave?employeeId=${id}` : "/leave"}
          empty="No leave requests."
          items={leave.items.map((r) => ({
            key: r.id,
            primary: `${r.startDate} → ${r.endDate}`,
            secondary: `${r.type} · ${r.status}`,
          }))}
          total={leave.total}
        />

        <SummaryCard
          title="Recent payslips"
          href={isOrgWide ? `/payroll?employeeId=${id}` : "/payroll"}
          empty="No payroll records."
          items={payroll.items.map((r) => ({
            key: r.id,
            primary: `${r.month}/${r.year}`,
            secondary: `${r.netPay} · ${r.status}`,
          }))}
          total={payroll.total}
        />
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  href,
  empty,
  items,
  total,
}: {
  title: string;
  href: string;
  empty: string;
  items: Array<{ key: string; primary: string; secondary: string }>;
  total: number;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <Button render={<Link href={href} />} variant="ghost" size="sm">
          View all
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.key} className="flex items-baseline justify-between gap-2">
                <span className="text-sm">{item.primary}</span>
                <span className="text-xs text-muted-foreground">{item.secondary}</span>
              </li>
            ))}
          </ul>
        )}
        {total > 0 ? (
          <p className="text-xs text-muted-foreground">
            {total} total
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
