import { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { PaginationNav } from "@/components/layout/list-controls";
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
import { pagePermission } from "@/lib/auth/page-guards";
import { actorFrom } from "@/lib/services/actor";
import { listAuditLogs } from "@/lib/services/audit-log";
import { parseListQuery, toUrlSearchParams } from "@/lib/pagination";
import { auditLogFilterSchema } from "@/lib/validation/admin";
import type { AuditOutcome } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Audit logs" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const OUTCOMES = [
  { value: "SUCCESS", label: "Success" },
  { value: "FAILURE", label: "Failure" },
] as const;

const OUTCOME_STYLE: Record<AuditOutcome, string> = {
  SUCCESS: "bg-emerald-100 text-emerald-800",
  FAILURE: "bg-rose-100 text-rose-800",
};

export default async function AuditPage({ searchParams }: PageProps) {
  // ADMIN only — the matrix grants `audit` read to ADMIN, everyone else 403s.
  const session = await pagePermission("audit", "read");

  const params = toUrlSearchParams(await searchParams);
  const query = parseListQuery(params);
  const filters = auditLogFilterSchema.parse({
    action: params.get("action") || undefined,
    entityType: params.get("entityType") || undefined,
    entityId: params.get("entityId") || undefined,
    actorId: params.get("actorId") || undefined,
    outcome: params.get("outcome") || undefined,
    dateFrom: params.get("dateFrom") || undefined,
    dateTo: params.get("dateTo") || undefined,
  });

  const data = await listAuditLogs(query, filters, actorFrom(session));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit logs"
        description="Append-only record of significant system actions, newest first."
      />
      <p className="text-sm text-muted-foreground">
        Append-only. There is no edit or delete path — by design.
      </p>

      {/* GET form: dates + entity type. A form submits only its own fields,
          so carry the rest of the active filters via hidden inputs. */}
      <form action="/audit" method="get" className="flex flex-wrap items-end gap-3">
        {filters.action ? <input type="hidden" name="action" value={filters.action} /> : null}
        {filters.entityId ? <input type="hidden" name="entityId" value={filters.entityId} /> : null}
        {filters.actorId ? <input type="hidden" name="actorId" value={filters.actorId} /> : null}
        {filters.outcome ? (
          <input type="hidden" name="outcome" value={filters.outcome} />
        ) : null}

        <div className="space-y-1">
          <Label htmlFor="audit-dateFrom" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="audit-dateFrom"
            name="dateFrom"
            type="date"
            defaultValue={filters.dateFrom ?? ""}
            className="h-8 w-[150px]"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-dateTo" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="audit-dateTo"
            name="dateTo"
            type="date"
            defaultValue={filters.dateTo ?? ""}
            className="h-8 w-[150px]"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-entityType" className="text-xs text-muted-foreground">
            Entity type
          </Label>
          <Input
            id="audit-entityType"
            name="entityType"
            type="text"
            defaultValue={filters.entityType ?? ""}
            placeholder="e.g. Employee"
            className="h-8 w-[180px]"
          />
        </div>
        <Button type="submit" variant="outline" size="sm">
          Apply filters
        </Button>
        {filters.dateFrom || filters.dateTo || filters.entityType || filters.action ? (
          <Button render={<Link href="/audit" />} variant="ghost" size="sm">
            Clear
          </Button>
        ) : null}
      </form>

      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by outcome">
        <FilterChip basePath="/audit" params={params} name="outcome" value="" label="All outcomes" />
        {OUTCOMES.map((o) => (
          <FilterChip
            key={o.value}
            basePath="/audit"
            params={params}
            name="outcome"
            value={o.value}
            label={o.label}
          />
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Metadata</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No audit entries match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-mono text-xs tabular-nums whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {log.actor ? (
                        <>
                          <span className="font-medium">{log.actor.email}</span>
                          <div className="text-xs text-muted-foreground">
                            {log.actor.role ?? "—"}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">system</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {log.action}
                      </code>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">{log.entityType}</span>
                      {log.entityId ? (
                        <div
                          className="max-w-[140px] truncate font-mono text-xs text-muted-foreground"
                          title={log.entityId}
                        >
                          {log.entityId.length > 12
                            ? `${log.entityId.slice(0, 12)}…`
                            : log.entityId}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${OUTCOME_STYLE[log.outcome]}`}
                      >
                        {log.outcome}
                      </span>
                    </TableCell>
                    <TableCell>
                      <code className="block max-w-[280px] whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
                        {JSON.stringify(log.metadata) ?? "null"}
                      </code>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PaginationNav
        basePath="/audit"
        params={params}
        page={data.page}
        pages={data.pages}
        total={data.total}
        itemLabel="entry"
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
