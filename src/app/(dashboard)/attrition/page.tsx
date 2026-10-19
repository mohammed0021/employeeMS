import { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { PaginationNav } from "@/components/layout/list-controls";
import {
  EditIndicatorsButton,
  RiskDistributionChart,
  RunPredictionsButton,
  type RiskDatum,
} from "@/components/attrition/attrition-actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { pagePermission } from "@/lib/auth/page-guards";
import { can } from "@/lib/auth/permissions";
import { actorFrom } from "@/lib/services/actor";
import { listIndicators, listSignals } from "@/lib/services/attrition";
import { parseAttritionListQuery } from "@/lib/validation/attrition";
import { toUrlSearchParams } from "@/lib/pagination";
import type { AttritionSignalDto } from "@/lib/services/attrition";
import type { RiskCategory } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Attrition analytics" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const CATEGORY_STYLE: Record<RiskCategory, string> = {
  HIGH: "bg-rose-100 text-rose-800",
  MEDIUM: "bg-amber-100 text-amber-800",
  LOW: "bg-emerald-100 text-emerald-800",
};

const CATEGORY_BAR: Record<RiskCategory, string> = {
  HIGH: "bg-rose-500",
  MEDIUM: "bg-amber-500",
  LOW: "bg-emerald-500",
};

const STAT_TONE: Record<RiskCategory, string> = {
  HIGH: "text-rose-600",
  MEDIUM: "text-amber-600",
  LOW: "text-emerald-600",
};

function RiskCategoryBadge({ category }: { category: RiskCategory }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLE[category]}`}
    >
      {category}
    </span>
  );
}

export default async function AttritionPage({ searchParams }: PageProps) {
  // ADMIN/HR only — EMPLOYEE holds no attrition action at all (page 403s them).
  const session = await pagePermission("attrition", "read");
  const { role } = session.user;

  const params = toUrlSearchParams(await searchParams);
  const { query, filters } = parseAttritionListQuery(params);
  // Attrition has no self-scoped view — a plain actor, never employeeScopeFrom.
  const actor = actorFrom(session);

  // Signals are already ordered riskScore desc by the service; indicators give
  // the edit dialog its default values.
  const [signals, indicators] = await Promise.all([
    listSignals(query, filters, actor),
    listIndicators(query, filters, actor),
  ]);

  const canRun = can(role, "attrition", "create");
  const canUpdate = can(role, "attrition", "update");
  // The run button persists a failed model load here so the honest state
  // survives re-renders until a run succeeds (or it is dismissed).
  const modelMissing = params.get("modelMissing") === "1";

  // Counts below are computed from the signal rows ALREADY FETCHED for this
  // page — no extra endpoint, no invented totals. Charts say the same.
  const counts: Record<RiskCategory, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const signal of signals.items) counts[signal.riskCategory] += 1;

  const chartData: RiskDatum[] = [
    { category: "HIGH", count: counts.HIGH },
    { category: "MEDIUM", count: counts.MEDIUM },
    { category: "LOW", count: counts.LOW },
  ];

  // Department summary: DERIVED from the loaded rows' employee.department,
  // not a server-side aggregate — it reflects this page, not the org.
  const departmentCounts = new Map<string, number>();
  for (const signal of signals.items) {
    const name = signal.employee?.department?.name ?? "Unassigned";
    departmentCounts.set(name, (departmentCounts.get(name) ?? 0) + 1);
  }
  const departments = [...departmentCounts.entries()].sort((a, b) => b[1] - a[1]);
  const maxDepartmentCount = Math.max(1, ...departments.map(([, count]) => count));

  const indicatorByEmployee = new Map(
    indicators.items.map((indicator) => [indicator.employeeId, indicator]),
  );

  // Model card facts come from the newest signal row actually loaded.
  const newest = signals.items.reduce<AttritionSignalDto | null>(
    (best, signal) => (!best || signal.generatedAt > best.generatedAt ? signal : best),
    null,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attrition analytics"
        description="Decision-support risk estimates — uncertain, never grounds for automated employment actions."
        actions={<RunPredictionsButton canRun={canRun} />}
      />

      {signals.total === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="font-medium">No predictions yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Run the model to generate risk scores from each employee&apos;s
              indicator rows.
            </p>
            {canRun ? <RunPredictionsButton canRun={canRun} variant="empty" /> : null}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(["HIGH", "MEDIUM", "LOW"] as const).map((category) => (
              <Card key={category}>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">{category} risk</p>
                  <p className={`text-3xl font-bold tabular-nums ${STAT_TONE[category]}`}>
                    {counts[category]}
                  </p>
                  <p className="text-xs text-muted-foreground">loaded rows</p>
                </CardContent>
              </Card>
            ))}
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Total signals</p>
                <p className="text-3xl font-bold tabular-nums">{signals.total}</p>
                <p className="text-xs text-muted-foreground">
                  {signals.items.length} on this page
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Risk distribution</CardTitle>
                <CardDescription>
                  Counts by category across the {signals.items.length} loaded signal
                  row{signals.items.length === 1 ? "" : "s"}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RiskDistributionChart data={chartData} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Department summary</CardTitle>
                <CardDescription>
                  Derived from the loaded signal rows (employees currently scored
                  on this page), not a server aggregate.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {departments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No departments among the loaded rows.
                  </p>
                ) : (
                  departments.map(([name, count]) => (
                    <div key={name} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 truncate text-sm">{name}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${(count / maxDepartmentCount) * 100}%` }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right text-sm tabular-nums">
                        {count}
                      </span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {modelMissing ? (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <p className="font-medium">No attrition model is loaded.</p>
          <p className="mt-1">
            The last prediction run failed with ATTRITION_MODEL_MISSING — no risk
            scores were produced. Train a model with{" "}
            <code className="rounded bg-amber-100 px-1">scripts/train-attrition.py</code>{" "}
            and place <code className="rounded bg-amber-100 px-1">models/attrition-model.json</code>{" "}
            (see models/README.md), then run predictions again.
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Risk signals</CardTitle>
          <CardDescription>
            Highest risk first. Estimates are uncertain — review the contributing
            indicators before acting.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Risk score</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Top factors</TableHead>
                <TableHead>Generated</TableHead>
                {canUpdate ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {signals.items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={canUpdate ? 6 : 5}
                    className="py-10 text-center text-muted-foreground"
                  >
                    No signal rows on this page.
                  </TableCell>
                </TableRow>
              ) : (
                signals.items.map((signal) => (
                  <TableRow key={signal.id}>
                    <TableCell>
                      <span className="font-medium">
                        {signal.employee?.fullName ?? "—"}
                      </span>
                      <div className="text-xs text-muted-foreground">
                        {signal.employee?.employeeCode}
                        {signal.employee?.department
                          ? ` · ${signal.employee.department.name}`
                          : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full ${CATEGORY_BAR[signal.riskCategory]}`}
                            style={{
                              width: `${Math.min(100, Math.round(signal.riskScore * 100))}%`,
                            }}
                          />
                        </div>
                        <span className="tabular-nums">{signal.riskScore.toFixed(2)}</span>
                        {signal.partialInputs ? (
                          <span
                            title="Some model inputs were missing for this employee — training-set defaults were imputed."
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
                          >
                            imputed
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <RiskCategoryBadge category={signal.riskCategory} />
                    </TableCell>
                    <TableCell>
                      {signal.topFactors && signal.topFactors.length > 0 ? (
                        <div className="flex max-w-[260px] flex-wrap gap-1">
                          {signal.topFactors.slice(0, 4).map((factor) => (
                            <span
                              key={factor.feature}
                              className="rounded-full border bg-muted/50 px-2 py-0.5 font-mono text-xs"
                            >
                              {factor.feature}{" "}
                              {factor.contribution >= 0 ? "+" : "−"}
                              {Math.abs(factor.contribution).toFixed(2)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {signal.generatedAt.slice(0, 16).replace("T", " ")}
                    </TableCell>
                    {canUpdate ? (
                      <TableCell className="text-right">
                        <EditIndicatorsButton
                          employeeId={signal.employeeId}
                          employeeName={signal.employee?.fullName ?? signal.employeeId}
                          indicator={indicatorByEmployee.get(signal.employeeId)}
                          canUpdate={canUpdate}
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
        basePath="/attrition"
        params={params}
        page={signals.page}
        pages={signals.pages}
        total={signals.total}
        itemLabel="signal"
      />

      {/* Model card: facts from the newest loaded signal — never an AUC we
          did not measure. */}
      <Card>
        <CardHeader>
          <CardTitle>Model</CardTitle>
          <CardDescription>
            Provenance of the scores on this page, from the newest loaded signal.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {newest && newest.modelName ? (
            <dl className="grid gap-1">
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Model:</dt>
                <dd className="font-medium">{newest.modelName}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Version:</dt>
                <dd className="tabular-nums">{newest.modelVersion ?? "—"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Generated:</dt>
                <dd className="tabular-nums">
                  {newest.generatedAt.slice(0, 16).replace("T", " ")}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Test AUC:</dt>
                <dd>not recorded</dd>
              </div>
            </dl>
          ) : (
            <p className="text-muted-foreground">
              Model: none loaded. Train one with{" "}
              <code className="rounded bg-muted px-1">scripts/train-attrition.py</code>{" "}
              and place{" "}
              <code className="rounded bg-muted px-1">models/attrition-model.json</code>{" "}
              (see models/README.md).
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
