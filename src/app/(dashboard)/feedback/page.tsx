import { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { PaginationNav, SearchForm } from "@/components/layout/list-controls";
import {
  FeedbackStatusBadge,
  FeedbackRowActions,
  NewFeedbackButton,
  type EmployeeOption,
} from "@/components/feedback/feedback-actions";
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
import { listFeedback } from "@/lib/services/feedback";
import { listEmployees } from "@/lib/services/employees";
import { resolveSort, toUrlSearchParams } from "@/lib/pagination";
import {
  FEEDBACK_SORT_COLUMNS,
  parseFeedbackListQuery,
  toFeedbackSort,
  type FeedbackIndicators,
} from "@/lib/validation/feedback";

export const metadata: Metadata = { title: "Performance feedback" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const STATUSES = [
  { value: "DRAFT", label: "Draft" },
  { value: "AI_DRAFT", label: "AI draft" },
  { value: "FINALIZED", label: "Finalized" },
] as const;

/** Average of the five 1-5 ratings — computed from the row's own indicators. */
function indicatorsSummary(indicators: FeedbackIndicators | null): string {
  if (!indicators) return "—";
  const avg =
    (indicators.communication +
      indicators.qualityOfWork +
      indicators.productivity +
      indicators.teamwork +
      indicators.reliability) /
    5;
  return `${avg.toFixed(1)} avg`;
}

export default async function FeedbackPage({ searchParams }: PageProps) {
  // ADMIN/HR hold `read` (org-wide); EMPLOYEE holds `readOwn` (their rows only).
  const session = await pagePermissionAny("feedback", "read", "readOwn");
  const { role } = session.user;
  const isOrgWide = can(role, "feedback", "read");

  const params = toUrlSearchParams(await searchParams);
  const { query, filters } = parseFeedbackListQuery(params);
  const sort = toFeedbackSort(resolveSort(params, FEEDBACK_SORT_COLUMNS, "createdAt"));

  // Reads go straight through the service (EMPLOYEE rows are scoped to the
  // session's employee there — never from the query string).
  const data = await listFeedback(query, filters, sort, employeeScopeFrom(session));

  const canCreate = can(role, "feedback", "create");
  const canUpdate = can(role, "feedback", "update");
  const canApprove = can(role, "feedback", "approve");

  // The create dialog needs a picker; only org-wide creators may see it.
  const employees: EmployeeOption[] =
    isOrgWide && canCreate
      ? (
          await listEmployees(
            { page: 1, limit: 100, q: undefined },
            {},
            { field: "lastName", dir: "asc" },
            employeeScopeFrom(session),
          )
        ).items.map((e) => ({ id: e.id, label: `${e.employeeCode} · ${e.fullName}` }))
      : [];

  const q = query.q ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        title={isOrgWide ? "Performance feedback" : "My feedback"}
        description={
          isOrgWide
            ? "Indicator-based reviews with AI-assisted drafts — a human writes and finalizes every word employees see."
            : "Your finalized reviews, exactly as they were finalized."
        }
        actions={<NewFeedbackButton employees={employees} canCreate={canCreate} />}
      />

      {isOrgWide ? (
        <SearchForm
          action="/feedback"
          value={q}
          placeholder="Search cycle or employee…"
          label="Search feedback"
        />
      ) : null}

      {isOrgWide ? (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter feedback">
          <FilterChip basePath="/feedback" params={params} name="status" value="" label="All" />
          {STATUSES.map((s) => (
            <FilterChip
              key={s.value}
              basePath="/feedback"
              params={params}
              name="status"
              value={s.value}
              label={s.label}
            />
          ))}
        </div>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {isOrgWide ? <TableHead>Employee</TableHead> : null}
                <TableHead>Cycle</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Indicators</TableHead>
                <TableHead>Created</TableHead>
                {isOrgWide ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={isOrgWide ? 6 : 4}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {isOrgWide
                      ? q
                        ? `No feedback matches “${q}”.`
                        : "No feedback yet."
                      : "No feedback has been finalized for you yet."}
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((feedback) => (
                  <TableRow key={feedback.id}>
                    {isOrgWide ? (
                      <TableCell>
                        <Link
                          href={`/feedback/${feedback.id}`}
                          className="font-medium hover:underline"
                        >
                          {feedback.employee?.fullName ?? "—"}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {feedback.employee?.employeeCode}
                        </div>
                      </TableCell>
                    ) : null}
                    <TableCell className="font-medium">{feedback.cycleLabel}</TableCell>
                    <TableCell>
                      <FeedbackStatusBadge status={feedback.status} />
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {indicatorsSummary(feedback.indicators)}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {feedback.createdAt.slice(0, 10)}
                    </TableCell>
                    {isOrgWide ? (
                      <TableCell>
                        <FeedbackRowActions
                          feedback={feedback}
                          canUpdate={canUpdate}
                          canApprove={canApprove}
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
        basePath="/feedback"
        params={params}
        page={data.page}
        pages={data.pages}
        total={data.total}
        itemLabel="review"
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
