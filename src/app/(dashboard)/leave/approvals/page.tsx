import { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { PaginationNav, SearchForm } from "@/components/layout/list-controls";
import {
  DecideLeaveButtons,
  LeaveStatusBadge,
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
import { pagePermission } from "@/lib/auth/page-guards";
import { actorFrom } from "@/lib/services/actor";
import { listPendingApprovals } from "@/lib/services/leave";
import { parseListQuery, toUrlSearchParams } from "@/lib/pagination";

export const metadata: Metadata = { title: "Leave approvals" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Approval queue: PENDING rows only, for the roles holding `approve`.
 *
 * The queue is deliberately a different view from /leave — an approver wants
 * "what needs me", not "everything" — so it calls `listPendingApprovals`
 * rather than filtering the general list client-side. Decisions are made
 * through the same buttons as the list; the service enforces the state machine
 * (PENDING → APPROVED/REJECTED) and blocks self-approval on every attempt.
 */
export default async function LeaveApprovalsPage({ searchParams }: PageProps) {
  const session = await pagePermission("leave", "approve");

  const params = toUrlSearchParams(await searchParams);
  const query = parseListQuery(params);

  const data = await listPendingApprovals(query, actorFrom(session));

  const q = query.q ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave approvals"
        description="Review pending requests and record approve/reject decisions."
        actions={
          <Link
            href="/leave"
            className="inline-flex h-8 items-center rounded-md border border-input bg-transparent px-3 text-sm font-medium hover:bg-accent"
          >
            All requests
          </Link>
        }
      />

      <SearchForm
        action="/leave/approvals"
        value={q}
        placeholder="Search reason or employee…"
        label="Search pending requests"
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead className="text-right">Decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    {q
                      ? `No pending requests match “${q}”.`
                      : "Nothing waiting for approval."}
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell>
                      <span className="font-medium">
                        {request.employee?.fullName ?? "—"}
                      </span>
                      <div className="text-xs text-muted-foreground">
                        {request.employee?.employeeCode}
                        {request.employee?.department
                          ? ` · ${request.employee.department.name}`
                          : ""}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {request.startDate} → {request.endDate}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {request.days}
                    </TableCell>
                    <TableCell>{request.type}</TableCell>
                    <TableCell>
                      <LeaveStatusBadge status={request.status} />
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-muted-foreground">
                      {request.reason}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {request.submittedAt.slice(0, 10)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end">
                        <DecideLeaveButtons request={request} canApprove />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PaginationNav
        basePath="/leave/approvals"
        params={params}
        page={data.page}
        pages={data.pages}
        total={data.total}
        itemLabel="request"
      />
    </div>
  );
}
