import { Metadata } from "next";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import {
  NewPolicyButton,
  PolicyRowActions,
  type DepartmentOption,
} from "@/components/policies/policy-actions";
import { PageHeader } from "@/components/layout/page-header";
import { PaginationNav, SearchForm } from "@/components/layout/list-controls";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { pagePermission, pageService } from "@/lib/auth/page-guards";
import { can } from "@/lib/auth/permissions";
import { toUrlSearchParams } from "@/lib/pagination";
import { listDepartments } from "@/lib/services/departments";
import { actorFrom } from "@/lib/services/actor";
import {
  getPolicy,
  listPolicies,
  type PolicySummaryDto,
} from "@/lib/services/policies";
import { policyListQuerySchema } from "@/lib/validation/policies";

export const metadata: Metadata = { title: "Policy documents" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminPoliciesPage({ searchParams }: PageProps) {
  const session = await pagePermission("policies", "read");

  const params = toUrlSearchParams(await searchParams);
  // Same schema the API parses, so a bad `?status=` fails identically here
  // and there instead of silently filtering nothing.
  const parsed = policyListQuerySchema.parse({
    page: params.get("page") ?? undefined,
    limit: params.get("limit") ?? undefined,
    q: params.get("q") ?? undefined,
    status: params.get("status") ?? undefined,
    departmentId: params.get("departmentId") ?? undefined,
  });

  const actor = actorFrom(session);
  const data = await listPolicies(
    { page: parsed.page, limit: parsed.limit, q: parsed.q },
    { status: parsed.status, departmentId: parsed.departmentId },
    actor,
  );

  const { role } = session.user;
  const canCreate = can(role, "policies", "create");
  const canDelete = can(role, "policies", "delete");

  // The list variant deliberately omits `errorMessage`; failed rows fetch the
  // full DTO so the table can state WHY extraction failed instead of a bare
  // red label. (Failed rows are the exception, so this stays a handful of reads.)
  const failedIds = data.items
    .filter((item) => item.status === "FAILED")
    .map((item) => item.id);
  const failureReasons = new Map<string, string>();
  if (failedIds.length > 0) {
    const documents = await Promise.all(
      failedIds.map((id) => pageService(() => getPolicy(id, actor))),
    );
    for (const doc of documents) {
      if (doc.errorMessage) failureReasons.set(doc.id, doc.errorMessage);
    }
  }

  // Department picker for the upload dialog — fetched only when it can be used.
  const departments: DepartmentOption[] = canCreate
    ? (await listDepartments({ page: 1, limit: 100, q: undefined }, actor)).items.map(
        (department) => ({ id: department.id, name: department.name }),
      )
    : [];

  const q = parsed.q ?? "";
  const activeStatus = parsed.status ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Policy documents"
        description="Approved documents that ground the HR chatbot's answers."
        actions={
          <NewPolicyButton canCreate={canCreate} departments={departments} />
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchForm
          action="/admin/policies"
          value={q}
          placeholder="Search title or file name…"
          label="Search policies"
        />
        <FilterRow
          basePath="/admin/policies"
          params={params}
          name="status"
          allLabel="All statuses"
          options={[
            { value: "READY", label: "READY" },
            { value: "PROCESSING", label: "PROCESSING" },
            { value: "FAILED", label: "FAILED" },
          ]}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Policy</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Chunks</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Uploaded</TableHead>
                {canDelete ? (
                  <TableHead className="text-right">Actions</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={canDelete ? 7 : 6}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {q || activeStatus
                      ? "No policies match the current filters."
                      : "No policy documents yet."}
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((policy) => (
                  <TableRow key={policy.id}>
                    <TableCell>
                      <div className="font-medium">{policy.title}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {policy.fileName}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {formatSize(policy.sizeBytes)}
                    </TableCell>
                    <TableCell>
                      <PolicyStatusBadge
                        status={policy.status}
                        errorMessage={failureReasons.get(policy.id) ?? null}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {policy.status === "READY" && policy.chunkCount > 0
                        ? `${policy.chunkCount} chunk${policy.chunkCount === 1 ? "" : "s"}`
                        : "—"}
                    </TableCell>
                    <TableCell>{policy.department?.name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {policy.createdAt.slice(0, 10)}
                    </TableCell>
                    {canDelete ? (
                      <TableCell>
                        <PolicyRowActions policy={policy} canDelete={canDelete} />
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
        basePath="/admin/policies"
        params={params}
        page={data.page}
        pages={data.pages}
        total={data.total}
        itemLabel="policy"
      />
    </div>
  );
}

/** Bytes → human size. DTOs are numbers here, but never float money. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** READY green, PROCESSING amber (still working), FAILED rose + the real reason. */
function PolicyStatusBadge({
  status,
  errorMessage,
}: {
  status: PolicySummaryDto["status"];
  errorMessage: string | null;
}) {
  if (status === "READY") {
    return (
      <Badge className="border-transparent bg-emerald-600/15 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
        READY
      </Badge>
    );
  }

  if (status === "PROCESSING") {
    return (
      <Badge className="border-transparent bg-amber-500/15 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
        <Loader2 className="animate-spin" aria-hidden />
        PROCESSING
      </Badge>
    );
  }

  return (
    <div className="space-y-1">
      <Badge className="border-transparent bg-rose-600/15 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400">
        FAILED
      </Badge>
      {errorMessage ? (
        <p className="max-w-56 whitespace-normal text-xs text-muted-foreground">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Status filter as toggle links (same shape as the other list pages): each
 * link keeps the search term and the rest of the query, and clicking the
 * active value clears the filter.
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
            key={chip.value || "all"}
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
