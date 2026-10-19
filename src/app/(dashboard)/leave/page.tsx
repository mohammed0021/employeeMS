import { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { PaginationNav, SearchForm } from "@/components/layout/list-controls";
import {
  CancelLeaveButton,
  DecideLeaveButtons,
  LeaveStatusBadge,
  SubmitLeaveButton,
} from "@/components/leave/leave-actions";
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
import { employeeScopeFrom } from "@/lib/services/actor";
import { listLeaveRequests } from "@/lib/services/leave";
import { resolveSort, toUrlSearchParams } from "@/lib/pagination";
import {
  LEAVE_SORT_COLUMNS,
  parseLeaveListQuery,
  toLeaveSort,
} from "@/lib/validation/leave";

export const metadata: Metadata = { title: "Leave" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const STATUSES = [
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "CANCELLED", label: "Cancelled" },
] as const;

const TYPES = [
  { value: "ANNUAL", label: "Annual" },
  { value: "SICK", label: "Sick" },
  { value: "UNPAID", label: "Unpaid" },
  { value: "OTHER", label: "Other" },
] as const;

export default async function LeavePage({ searchParams }: PageProps) {
  // ADMIN/HR hold `read` (all rows); EMPLOYEE holds `create/readOwn/update`.
  const session = await pagePermissionAny("leave", "read", "readOwn");
  const { role } = session.user;
  const isOrgWide = can(role, "leave", "read");

  const params = toUrlSearchParams(await searchParams);
  const query = parseLeaveListQuery(params);
  const sort = toLeaveSort(resolveSort(params, LEAVE_SORT_COLUMNS, "submittedAt"));

  const data = await listLeaveRequests(query, sort, employeeScopeFrom(session));

  const canCreate = can(role, "leave", "create");
  const canApprove = can(role, "leave", "approve");
  const canCancel = can(role, "leave", "update");
  const q = query.q ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        title={isOrgWide ? "Leave requests" : "My leave"}
        description={
          isOrgWide
            ? "Approve, reject and track time off across the organization."
            : "Your time-off requests. Withdraw any while it is pending."
        }
        actions={<SubmitLeaveButton canCreate={canCreate} />}
      />

      <SearchForm
        action="/leave"
        value={q}
        placeholder="Search reason or employee…"
        label="Search leave"
      />

      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter leave">
        <FilterChip basePath="/leave" params={params} name="status" value="" label="All" />
        {STATUSES.map((s) => (
          <FilterChip
            key={s.value}
            basePath="/leave"
            params={params}
            name="status"
            value={s.value}
            label={s.label}
          />
        ))}
        <span className="mx-2 h-5 w-px bg-border" aria-hidden />
        <FilterChip basePath="/leave" params={params} name="type" value="" label="Any type" />
        {TYPES.map((t) => (
          <FilterChip
            key={t.value}
            basePath="/leave"
            params={params}
            name="type"
            value={t.value}
            label={t.label}
          />
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dates</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Submitted</TableHead>
                {isOrgWide ? <TableHead>Employee</TableHead> : null}
                {canApprove || canCancel ? (
                  <TableHead className="text-right">Actions</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={
                      (isOrgWide ? 7 : 6) + (canApprove || canCancel ? 1 : 0)
                    }
                    className="py-10 text-center text-muted-foreground"
                  >
                    {q
                      ? `No requests match “${q}”.`
                      : isOrgWide
                        ? "No leave requests."
                        : "You have not requested any leave yet."}
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((request) => {
                  // EMPLOYEE can cancel only their own; APPROVE needs the
                  // approver action. The service enforces both regardless.
                  const isOwn = !isOrgWide;
                  return (
                    <TableRow key={request.id}>
                      <TableCell className="tabular-nums">
                        {request.startDate} → {request.endDate}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {request.days}
                      </TableCell>
                      <TableCell>{request.type}</TableCell>
                      <TableCell>
                        <LeaveStatusBadge status={request.status} />
                        {request.status === "REJECTED" && request.decisionReason ? (
                          <div className="max-w-[220px] truncate text-xs text-muted-foreground">
                            {request.decisionReason}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate text-muted-foreground">
                        {request.reason}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {request.submittedAt.slice(0, 10)}
                      </TableCell>
                      {isOrgWide ? (
                        <TableCell>
                          <span className="font-medium">
                            {request.employee?.fullName ?? "—"}
                          </span>
                          <div className="text-xs text-muted-foreground">
                            {request.employee?.employeeCode}
                          </div>
                        </TableCell>
                      ) : null}
                      {canApprove || canCancel ? (
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <DecideLeaveButtons
                              request={request}
                              canApprove={canApprove}
                            />
                            <CancelLeaveButton
                              request={request}
                              canCancel={canCancel && isOwn}
                            />
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PaginationNav
        basePath="/leave"
        params={params}
        page={data.page}
        pages={data.pages}
        total={data.total}
        itemLabel="request"
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
