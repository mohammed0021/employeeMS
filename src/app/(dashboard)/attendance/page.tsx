import { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { PaginationNav, SearchForm } from "@/components/layout/list-controls";
import {
  AttendanceStatusBadge,
  CorrectAttendanceButton,
  RecordAttendanceButton,
  type EmployeeLite,
} from "@/components/attendance/attendance-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { pagePermissionAny } from "@/lib/auth/page-guards";
import { can } from "@/lib/auth/permissions";
import { employeeScopeFrom } from "@/lib/services/actor";
import { listAttendance } from "@/lib/services/attendance";
import { listEmployees } from "@/lib/services/employees";
import { parseListQuery, resolveSort, toUrlSearchParams } from "@/lib/pagination";
import {
  ATTENDANCE_SORT_FIELDS,
  attendanceListFiltersSchema,
} from "@/lib/validation/attendance";

export const metadata: Metadata = { title: "Attendance" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Statuses offered as toggle chips; matches the validation enum. */
const STATUSES = [
  { value: "PRESENT", label: "Present" },
  { value: "REMOTE", label: "Remote" },
  { value: "HALF_DAY", label: "Half day" },
  { value: "ABSENT", label: "Absent" },
] as const;

export default async function AttendancePage({ searchParams }: PageProps) {
  const session = await pagePermissionAny("attendance", "read", "readOwn");
  const { role } = session.user;
  const isOrgWide = can(role, "attendance", "read");

  const params = toUrlSearchParams(await searchParams);
  const query = parseListQuery(params);
  const filters = attendanceListFiltersSchema.parse({
    dateFrom: params.get("dateFrom") || undefined,
    dateTo: params.get("dateTo") || undefined,
    employeeId: isOrgWide ? params.get("employeeId") || undefined : undefined,
    status: params.get("status") || undefined,
  });
  const sort = resolveSort(params, new Set(ATTENDANCE_SORT_FIELDS), "date");

  const actor = employeeScopeFrom(session);
  const data = await listAttendance(query, filters, sort, actor);

  // The record dialog needs a picker; only org-wide readers may see it.
  const employees: EmployeeLite[] = isOrgWide
    ? (
        await listEmployees(
          { page: 1, limit: 100, q: undefined },
          {},
          { field: "lastName", dir: "asc" },
          actor,
        )
      ).items.map((e) => ({ id: e.id, label: `${e.employeeCode} · ${e.fullName}` }))
    : [];

  const canCreate = can(role, "attendance", "create");
  const canCorrect = can(role, "attendance", "update");
  const q = query.q ?? "";
  const hours = (a: string | null, b: string | null): string => {
    if (!a || !b) return "—";
    const ms = Date.parse(b) - Date.parse(a);
    if (Number.isNaN(ms) || ms < 0) return "—";
    return (ms / 3_600_000).toFixed(2);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description={
          isOrgWide
            ? "Daily records, summaries and corrections."
            : "Your own attendance history."
        }
        actions={
          <div className="flex items-center gap-2">
            {isOrgWide ? (
              <Button
                render={<Link href="/api/attendance/export" />}
                variant="outline"
                size="sm"
              >
                Export CSV
              </Button>
            ) : null}
            <RecordAttendanceButton employees={employees} canCreate={canCreate} />
          </div>
        }
      />

      <SearchForm
        action="/attendance"
        value={q}
        placeholder="Search employee or note…"
        label="Search attendance"
      />

      {isOrgWide ? (
        <form
          action="/attendance"
          method="get"
          className="flex flex-wrap items-end gap-3"
        >
          {/* A date-range form submits only its own fields, so carry the rest. */}
          {q ? <input type="hidden" name="q" value={q} /> : null}
          {filters.status ? (
            <input type="hidden" name="status" value={filters.status} />
          ) : null}

          <div className="space-y-1">
            <Label htmlFor="dateFrom" className="text-xs text-muted-foreground">
              From
            </Label>
            <Input
              id="dateFrom"
              name="dateFrom"
              type="date"
              defaultValue={filters.dateFrom ?? ""}
              className="h-8 w-[150px]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dateTo" className="text-xs text-muted-foreground">
              To
            </Label>
            <Input
              id="dateTo"
              name="dateTo"
              type="date"
              defaultValue={filters.dateTo ?? ""}
              className="h-8 w-[150px]"
            />
          </div>
          <Button type="submit" variant="outline" size="sm">
            Apply range
          </Button>
          {(filters.dateFrom || filters.dateTo) && (
            <Button render={<Link href="/attendance" />} variant="ghost" size="sm">
              Clear
            </Button>
          )}
        </form>
      ) : null}

      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Status filter">
        <FilterChip
          basePath="/attendance"
          params={params}
          name="status"
          value=""
          label="All"
        />
        {STATUSES.map((s) => (
          <FilterChip
            key={s.value}
            basePath="/attendance"
            params={params}
            name="status"
            value={s.value}
            label={s.label}
          />
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                {isOrgWide ? <TableHead>Employee</TableHead> : null}
                <TableHead>Status</TableHead>
                <TableHead>In</TableHead>
                <TableHead>Out</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead>Note</TableHead>
                {canCorrect ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={(isOrgWide ? 7 : 6) + (canCorrect ? 1 : 0)}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {q ? `No records match “${q}”.` : "No attendance records yet."}
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="tabular-nums">{record.date}</TableCell>
                    {isOrgWide ? (
                      <TableCell>
                        <Link
                          href={`/employees/${record.employeeId}`}
                          className="font-medium hover:underline"
                        >
                          {record.employee?.fullName ?? "—"}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {record.employee?.employeeCode}
                        </div>
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <AttendanceStatusBadge status={record.status} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {record.checkIn ? record.checkIn.slice(11, 16) : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {record.checkOut ? record.checkOut.slice(11, 16) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {hours(record.checkIn, record.checkOut)}
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate text-muted-foreground">
                      {record.note ?? "—"}
                    </TableCell>
                    {canCorrect ? (
                      <TableCell className="text-right">
                        <CorrectAttendanceButton
                          record={record}
                          canCorrect={canCorrect}
                        />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PaginationNav
        basePath="/attendance"
        params={params}
        page={data.page}
        pages={data.pages}
        total={data.total}
        itemLabel="record"
      />
    </div>
  );
}

/** Toggle chip that rewrites one filter param and keeps the rest intact. */
function FilterChip({
  basePath,
  params,
  name,
  value,
  label,
}: {
  basePath: string;
  params: URLSearchParams;
  name: string;
  value: string;
  label: string;
}) {
  const active = params.get(name) ?? "";
  const isActive = active === value;

  function hrefFor(next: string): string {
    const clone = new URLSearchParams(params.toString());
    // Clicking the active value clears it; otherwise set it.
    if (!next || next === active) clone.delete(name);
    else clone.set(name, next);
    const qs = clone.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  return (
    <Link
      href={hrefFor(value)}
      aria-pressed={isActive}
      className={[
        "inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors",
        isActive
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-transparent text-foreground hover:bg-accent",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}
