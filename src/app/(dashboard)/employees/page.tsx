import { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { PaginationNav, SearchForm } from "@/components/layout/list-controls";
import {
  EmployeeRowActions,
  NewEmployeeButton,
  type DepartmentOption,
} from "@/components/employees/employee-actions";
import { EmployeeStatusBadge } from "@/components/employees/employee-detail";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { canSeeSalary, type DepartmentDto } from "@/lib/dto";
import { pagePermissionAny } from "@/lib/auth/page-guards";
import { can } from "@/lib/auth/permissions";
import { employeeScopeFrom } from "@/lib/services/actor";
import { listEmployees } from "@/lib/services/employees";
import { listDepartments } from "@/lib/services/departments";
import { parseListQuery, resolveSort, toUrlSearchParams } from "@/lib/pagination";
import { employeeFilterSchema, EMPLOYEE_SORT_FIELDS } from "@/lib/validation/employees";

export const metadata: Metadata = { title: "Employees" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Sentinel used in the URL for "no department"; real ids are never "all". */
const ALL = "all";

export default async function EmployeesPage({ searchParams }: PageProps) {
  const session = await pagePermissionAny("employees", "read", "readOwn");
  const { role } = session.user;
  const isOrgWide = can(role, "employees", "read");

  const params = toUrlSearchParams(await searchParams);
  const query = parseListQuery(params);
  const filters = employeeFilterSchema.parse({
    q: params.get("q") || undefined,
    // An EMPLOYEE's foreign `?departmentId=` is ignored by the service anyway;
    // we simply never surface the control to them.
    departmentId: isOrgWide ? params.get("departmentId") || undefined : undefined,
    status: isOrgWide ? params.get("status") || undefined : undefined,
  });
  const sort = resolveSort(params, EMPLOYEE_SORT_FIELDS, "lastName");

  const actor = employeeScopeFrom(session);
  // Departments feed the filter dropdown and the create/edit <select>. Only
  // fetched for roles that can actually act on them.
  const departments: DepartmentDto[] =
    can(role, "departments", "read") || can(role, "employees", "create")
      ? (await listDepartments({ page: 1, limit: 100, q: undefined }, actor)).items
      : [];

  const data = await listEmployees(query, filters, sort, actor);

  const canCreate = can(role, "employees", "create");
  const canUpdate = can(role, "employees", "update");
  const canDelete = can(role, "employees", "delete");
  const showSalary = canSeeSalary(role);
  const q = query.q ?? "";
  const activeDept = filters.departmentId ?? "";
  const activeStatus = filters.status ?? "";

  const options: DepartmentOption[] = departments.map((d) => ({
    id: d.id,
    name: d.name,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={isOrgWide ? "Employee directory" : "My profile"}
        description={
          isOrgWide
            ? "Search, filter and manage employee records."
            : "Your own employee record as held by HR."
        }
        actions={
          <div className="flex items-center gap-2">
            {isOrgWide ? (
              <Button render={<Link href="/api/employees/export" />} variant="outline" size="sm">
                Export CSV
              </Button>
            ) : null}
            <NewEmployeeButton
              canCreate={canCreate}
              departments={options}
              role={role}
            />
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchForm
          action="/employees"
          value={q}
          placeholder="Search name, code, email or position…"
          label="Search employees"
        />

        {isOrgWide ? (
          <>
            <FilterRow
              basePath="/employees"
              params={params}
              name="departmentId"
              allLabel="All departments"
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
            />
            <FilterRow
              basePath="/employees"
              params={params}
              name="status"
              allLabel="All statuses"
              options={[
                { value: "ACTIVE", label: "ACTIVE" },
                { value: "ON_LEAVE", label: "ON_LEAVE" },
                { value: "INACTIVE", label: "INACTIVE" },
              ]}
            />
          </>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Status</TableHead>
                {showSalary ? <TableHead className="text-right">Salary</TableHead> : null}
                {canUpdate || canDelete ? (
                  <TableHead className="text-right">Actions</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={
                      (showSalary ? 7 : 6) + (canUpdate || canDelete ? 1 : 0)
                    }
                    className="py-10 text-center text-muted-foreground"
                  >
                    {q || activeDept || activeStatus
                      ? "No employees match the current filters."
                      : "No employees yet."}
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((employee) => (
                  <TableRow key={employee.id}>
                    <TableCell className="font-mono text-sm">
                      {employee.employeeCode}
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link
                        href={`/employees/${employee.id}`}
                        className="hover:underline"
                      >
                        {employee.fullName}
                      </Link>
                      <div className="text-xs text-muted-foreground">{employee.email}</div>
                    </TableCell>
                    <TableCell>{employee.position}</TableCell>
                    <TableCell>{employee.department?.name ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{employee.joinDate}</TableCell>
                    <TableCell>
                      <EmployeeStatusBadge status={employee.status} />
                    </TableCell>
                    {showSalary ? (
                      <TableCell className="text-right tabular-nums">
                        {employee.salary ?? "—"}
                      </TableCell>
                    ) : null}
                    {canUpdate || canDelete ? (
                      <TableCell>
                        <EmployeeRowActions
                          employee={employee}
                          canUpdate={canUpdate}
                          canDelete={canDelete}
                          departments={options}
                          role={role}
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
        basePath="/employees"
        params={params}
        page={data.page}
        pages={data.pages}
        total={data.total}
        itemLabel="employee"
      />
    </div>
  );
}

/**
 * A single filter rendered as a row of toggle links.
 *
 * Links (rather than a native GET form) because a form submit would drop every
 * other query param — the other filter, the search term, the sort. Each link
 * rebuilds the full query string, keeping whatever else is active and clearing
 * itself when already selected (clicking the active value removes the filter).
 *
 * `ALL` is the sentinel for "no filter" and is never a real id/status, so it
 * can't collide with a genuine value.
 */
function FilterRow({
  basePath,
  params,
  name,
  options,
  allLabel,
}: {
  basePath: string;
  params: URLSearchParams;
  name: string;
  options: Array<{ value: string; label: string }>;
  allLabel: string;
}) {
  const active = params.get(name) ?? "";

  function hrefFor(next: string): string {
    const clone = new URLSearchParams(params.toString());
    // Clicking the active option toggles it off; otherwise set/clear.
    if (!next || next === active) clone.delete(name);
    else clone.set(name, next);
    const qs = clone.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const chips = [{ value: "", label: allLabel }, ...options];

  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={allLabel}>
      {chips.map((chip) => {
        const isActive = chip.value === active;
        return (
          <Link
            key={chip.value || ALL}
            href={hrefFor(chip.value)}
            aria-pressed={isActive}
            className={[
              "inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors",
              isActive
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-transparent text-foreground hover:bg-accent",
            ].join(" ")}
          >
            {chip.label}
          </Link>
        );
      })}
    </div>
  );
}
