import { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import {
  FeedbackStatusBadge,
  FeedbackFinalTextEditor,
  GenerateDraftButton,
} from "@/components/feedback/feedback-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { pagePermissionAny, pageService } from "@/lib/auth/page-guards";
import { can } from "@/lib/auth/permissions";
import { employeeScopeFrom } from "@/lib/services/actor";
import { getFeedback } from "@/lib/services/feedback";
import type { FeedbackIndicators } from "@/lib/validation/feedback";

export const metadata: Metadata = { title: "Feedback detail" };

type Props = { params: Promise<{ id: string }> };

const RATING_ROWS: Array<{ key: keyof FeedbackIndicators; label: string }> = [
  { key: "communication", label: "Communication" },
  { key: "qualityOfWork", label: "Quality of work" },
  { key: "productivity", label: "Productivity" },
  { key: "teamwork", label: "Teamwork" },
  { key: "reliability", label: "Reliability" },
];

export default async function FeedbackDetailPage({ params }: Props) {
  const { id } = await params;
  // ADMIN/HR read any row; EMPLOYEE reads only their own — the service
  // decides, and pageService maps a 403/404 AppError to the right page.
  const session = await pagePermissionAny("feedback", "read", "readOwn");
  const { role } = session.user;
  const feedback = await pageService(() =>
    getFeedback(id, employeeScopeFrom(session)),
  );

  const isOrgWide = can(role, "feedback", "read");
  const canUpdate = can(role, "feedback", "update");
  const canApprove = can(role, "feedback", "approve");
  const editable = feedback.status !== "FINALIZED";

  return (
    <div className="space-y-6">
      <Button render={<Link href="/feedback" />} variant="ghost" size="sm">
        <ArrowLeft className="size-4" aria-hidden />
        Back to feedback
      </Button>

      <PageHeader
        title={feedback.employee ? `${feedback.employee.fullName}` : "Feedback"}
        description={`${feedback.employee?.employeeCode ?? "—"} · ${
          feedback.employee?.position ?? "—"
        } · ${feedback.cycleLabel}`}
        actions={<FeedbackStatusBadge status={feedback.status} />}
      />

      {/* Header: authorship + finalization facts. */}
      <Card>
        <CardHeader>
          <CardTitle>Review record</CardTitle>
          <CardDescription>
            {feedback.status === "FINALIZED"
              ? `Finalized ${new Date(feedback.finalizedAt ?? feedback.updatedAt).toLocaleString()}${
                  isOrgWide && feedback.reviewer
                    ? ` · Reviewer ${feedback.reviewer.email}`
                    : ""
                }. Finalized reviews are immutable.`
              : "Draft in progress — nothing here is visible to the employee until it is finalized."}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Created {new Date(feedback.createdAt).toLocaleString()} · Last updated{" "}
          {new Date(feedback.updatedAt).toLocaleString()}
        </CardContent>
      </Card>

      {/* Indicators: the structured 1-5 ratings the review is built on. */}
      <Card>
        <CardHeader>
          <CardTitle>Indicators</CardTitle>
          <CardDescription>Structured 1-5 ratings supplied by the reviewer.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {feedback.indicators ? (
            <>
              <div className="space-y-3">
                {RATING_ROWS.map(({ key, label }) => {
                  const value = feedback.indicators?.[key];
                  const numeric =
                    typeof value === "number" ? value : null;
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 text-sm">{label}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{
                            width: numeric ? `${(numeric / 5) * 100}%` : "0%",
                          }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right text-sm tabular-nums">
                        {numeric ? `${numeric}/5` : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="text-sm font-medium">Strengths</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {feedback.indicators.strengths || "—"}
                  </p>
                </div>
                <div>
                  <h3 className="text-sm font-medium">Improvement areas</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {feedback.indicators.improvementAreas || "—"}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No structured indicators were stored for this review.
            </p>
          )}
        </CardContent>
      </Card>

      {/* AI draft: model provenance is shown, including the MOCK marker. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            AI draft
            {feedback.aiModel === "mock" ? (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                MOCK
              </span>
            ) : null}
          </CardTitle>
          <CardDescription>
            {feedback.aiDraft
              ? `Generated by ${feedback.aiModel ?? "an unknown model"}${
                  feedback.generatedAt
                    ? ` on ${new Date(feedback.generatedAt).toLocaleString()}`
                    : ""
                }. A human must edit and approve it — it is never shown as-is.`
              : "No draft has been generated for this review."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {feedback.aiDraft ? (
            <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">
              {feedback.aiDraft}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No AI draft yet.</p>
          )}
          {editable && canUpdate && !feedback.aiDraft ? (
            <GenerateDraftButton
              feedbackId={feedback.id}
              cycleLabel={feedback.cycleLabel}
            />
          ) : null}
        </CardContent>
      </Card>

      {/* Final text: read-only once FINALIZED, editable (with actions) before. */}
      <Card>
        <CardHeader>
          <CardTitle>Final text</CardTitle>
          <CardDescription>
            {feedback.status === "FINALIZED"
              ? "What the employee sees, verbatim. Immutable."
              : "What the employee will see, verbatim, once finalized."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {feedback.status === "FINALIZED" ? (
            <p className="whitespace-pre-wrap rounded-md border bg-background p-3 text-sm">
              {feedback.finalText || "—"}
            </p>
          ) : canUpdate || canApprove ? (
            <FeedbackFinalTextEditor
              feedback={feedback}
              canUpdate={canUpdate}
              canApprove={canApprove}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {feedback.finalText
                ? feedback.finalText
                : "Not finalized yet — nothing to show."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
