import { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { PaginationNav, SearchForm } from "@/components/layout/list-controls";
import {
  EditPayrollButton,
  FinalizePayrollButton,
  GeneratePayrollButton,
  PayrollStatusBadge,
} from "@/components/payroll/payroll-actions";
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
import { pagePermissionAny } from "@/lib/auth/page-guards";
import { can } from "@/lib/auth/permissions";
import { listEmployees } from "@/lib/services/employees";
import {
  PAYROLL_SORT_FIELDS,
  listPayrolls,
  payrollActorFrom,
} from "@/lib/services/payroll";
import { parseListQuery, resolveSort, toUrlSearchParams } from "@/lib/pagination";
import { parsePayrollFilters } from "@/lib/validation/payroll";

export const metadata: Metadata = { title: "Payroll" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Month names for the period select. */
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1));

export default async function PayrollPage({ searchParams }: PageProps) {
  // ADMIN/HR hold `read` (all records); EMPLOYEE holds `readOwn` (own payslips).
  const session = await pagePermissionAny("payroll", "read", "readOwn");
  const { role } = session.user;
  const isOrgWide = can(role, "payroll", "read");

  const params = toUrlSearchParams(await searchParams);
  const query = parseListQuery(params);
  const filters = parsePayrollFilters(params);
  const sort = resolveSort(params, PAYROLL_SORT_FIELDS, "createdAt");

  const actor = payrollActorFrom(session);
  const data = await listPayrolls(query, filters, sort, actor);

  // Employee picker for the generate dialog (org-wide only).
  const employees = isOrgWide
    ? (
        await listEmployees(
          { page: 1, limit: 100, q: undefined },
          {},
          { field: "lastName", dir: "asc" },
          actor,
        )
      ).items.map((e) => ({ id: e.id, label: `${e.employeeCode} · ${e.fullName}` }))
    : [];

  const canCreate = can(role, "payroll", "create");
  const canUpdate = can(role, "payroll", "update");
  const canExport = can(role, "payroll", "export");
  const q = query.q ?? "";
  const activeYear = params.get("year") ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        title={isOrgWide ? "Payroll" : "My payslips"}
        description={
          isOrgWide
            ? "Generate, finalize and export payroll records."
            : "Your finalized payslips and drafts in progress."
        }
        actions={
          <div className="flex items-center gap-2">
            {isOrgWide && canExport ? (
              <Button render={<Link href="/api/payroll/export" />} variant="outline" size="sm">
                Export CSV
              </Button>
            ) : null}
            <GeneratePayrollButton employees={employees} canCreate={canCreate} />
          </div>
        }
      />

      <SearchForm
        action="/payroll"
        value={q}
        placeholder="Search employee or code…"
        label="Search payroll"
      />

      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter payroll">
        <FilterChip basePath="/payroll" params={params} name="status" value="" label="All" />
        <FilterChip basePath="/payroll" params={params} name="status" value="DRAFT" label="Draft" />
        <FilterChip basePath="/payroll" params={params} name="status" value="FINAL" label="Final" />
        <span className="mx-2 h-5 w-px bg-border" aria-hidden />
        <FilterChip basePath="/payroll" params={params} name="year" value="" label="All years" />
        {["2026", "2025"].map((y) => (
          <FilterChip
            key={y}
            basePath="/payroll"
            params={params}
            name="year"
            value={y}
            label={y}
          />
        ))}
        <span className="mx-2 h-5 w-px bg-border" aria-hidden />
        <FilterChip basePath="/payroll" params={params} name="month" value="" label="All months" />
        {MONTHS.map((m) => (
          <FilterChip
            key={m}
            basePath="/payroll"
            params={params}
            name="month"
            value={m}
            label={m}
          />
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                {isOrgWide ? <TableHead>Employee</TableHead> : null}
                <TableHead className="text-right">Base</TableHead>
                <TableHead className="text-right">Bonus</TableHead>
                <TableHead className="text-right">Deduction</TableHead>
                <TableHead className="text-right">Net pay</TableHead>
                <TableHead>Status</TableHead>
                {canUpdate ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={(isOrgWide ? 7 : 6) + (canUpdate ? 1 : 0)}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {q || activeYear
                      ? "No records match the current filters."
                      : isOrgWide
                        ? "No payroll records yet."
                        : "No payslips yet."}
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="tabular-nums">
                      <Link
                        href={`/payroll/payslip/${record.id}`}
                        className="font-medium hover:underline"
                      >
                        {String(record.month).padStart(2, "0")}/{record.year}
                      </Link>
                    </TableCell>
                    {isOrgWide ? (
                      <TableCell>
                        <span className="font-medium">
                          {record.employee?.fullName ?? "—"}
                        </span>
                        <div className="text-xs text-muted-foreground">
                          {record.employee?.employeeCode}
                        </div>
                      </TableCell>
                    ) : null}
                    <TableCell className="text-right tabular-nums">
                      {record.baseSalary}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {record.bonus}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {record.deduction}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {record.netPay}
                    </TableCell>
                    <TableCell>
                      <PayrollStatusBadge status={record.status} />
                    </TableCell>
                    {canUpdate ? (
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <EditPayrollButton record={record} canUpdate={canUpdate} />
                          <FinalizePayrollButton record={record} canUpdate={canUpdate} />
                        </div>
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
        basePath="/payroll"
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
