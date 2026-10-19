"use client";

/**
 * Performance-feedback mutation UI: create (ADMIN/HR), generate AI draft
 * (ADMIN/HR), finalize with human-written text (ADMIN/HR).
 *
 * Reads stay server-rendered (the page calls the service directly); only
 * mutations cross the network, then `router.refresh()` re-runs the server
 * render. Permission flags are computed server-side via `can()` and passed
 * down — this is UX gating only; the API re-checks every request.
 *
 * The AI's 503 (unconfigured provider) and 429 (budget exhausted) messages
 * are surfaced VERBATIM: an honest failure is the whole point — a draft that
 * did not come from a model must never look like one did.
 */
import * as React from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, ExternalLink, Loader2, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { FeedbackDto } from "@/lib/services/feedback";
import type { FeedbackStatus } from "@/generated/prisma/enums";

/** Employee reference for the create dialog's picker. */
export type EmployeeOption = { id: string; label: string };

type ApiErrorBody = { code?: string; message?: string };

function FormError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

// ─── Status badge ───────────────────────────────────────────────────────────

const STATUS_STYLE: Record<FeedbackStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  AI_DRAFT: "bg-violet-100 text-violet-700",
  FINALIZED: "bg-emerald-100 text-emerald-800",
};

export function FeedbackStatusBadge({ status }: { status: FeedbackStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

// ─── Create (header action) ─────────────────────────────────────────────────

/** One 1..5 rating, mirroring validation/feedback.ts's rating(). */
const rating = z
  .number({ message: "Rating is required." })
  .int("Rating must be a whole number.")
  .min(1, "Rating must be at least 1.")
  .max(5, "Rating must be 5 or fewer.");

/** Mirrors src/lib/validation/feedback.ts createFeedbackSchema (+ indicators). */
const createSchema = z.object({
  employeeId: z.string().min(1, "Pick an employee."),
  cycleLabel: z
    .string()
    .trim()
    .min(2, "Cycle label must be at least 2 characters.")
    .max(80, "Cycle label must be 80 characters or fewer."),
  communication: rating,
  qualityOfWork: rating,
  productivity: rating,
  teamwork: rating,
  reliability: rating,
  strengths: z
    .string()
    .trim()
    .max(500, "Strengths must be 500 characters or fewer."),
  improvementAreas: z
    .string()
    .trim()
    .max(500, "Improvement areas must be 500 characters or fewer."),
});

type CreateValues = z.infer<typeof createSchema>;

const RATING_FIELDS = [
  { name: "communication", label: "Communication" },
  { name: "qualityOfWork", label: "Quality of work" },
  { name: "productivity", label: "Productivity" },
  { name: "teamwork", label: "Teamwork" },
  { name: "reliability", label: "Reliability" },
] as const;

function defaultCreateValues(): CreateValues {
  return {
    employeeId: "",
    cycleLabel: "",
    communication: 3,
    qualityOfWork: 3,
    productivity: 3,
    teamwork: 3,
    reliability: 3,
    strengths: "",
    improvementAreas: "",
  };
}

/** Header action: start a DRAFT review (ADMIN/HR — flag from the server). */
export function NewFeedbackButton({
  employees,
  canCreate,
}: {
  employees: EmployeeOption[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: defaultCreateValues(),
  });

  if (!canCreate) return null;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // Re-seed on every open so a cancelled draft can't leak stale values.
      reset(defaultCreateValues());
      setServerError(null);
    }
  }

  async function onSubmit(values: CreateValues) {
    setServerError(null);

    const indicators: Record<string, unknown> = {
      communication: values.communication,
      qualityOfWork: values.qualityOfWork,
      productivity: values.productivity,
      teamwork: values.teamwork,
      reliability: values.reliability,
    };
    // Optional prose: omit when blank rather than storing "".
    if (values.strengths) indicators.strengths = values.strengths;
    if (values.improvementAreas) indicators.improvementAreas = values.improvementAreas;

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: values.employeeId,
          cycleLabel: values.cycleLabel,
          indicators,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setServerError(data?.message ?? "Unable to create the feedback draft.");
        return;
      }

      setOpen(false);
      reset(defaultCreateValues());
      toast.success("Feedback draft created.");
      router.refresh();
    } catch {
      setServerError("Network error. Please try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="size-4" aria-hidden />
            New feedback
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New feedback</DialogTitle>
          <DialogDescription>
            Start a DRAFT review with structured 1-5 indicators. Nothing is shown
            to the employee until you finalize it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field label="Employee" error={errors.employeeId?.message}>
            <Select
              value={watch("employeeId")}
              onValueChange={(v) =>
                setValue("employeeId", v ?? "", { shouldValidate: true })
              }
            >
              <SelectTrigger id="fb-emp" className="w-full">
                <SelectValue placeholder="Pick an employee" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Review cycle" error={errors.cycleLabel?.message}>
            <Input
              id="fb-cycle"
              placeholder="e.g. 2026 H1"
              aria-invalid={Boolean(errors.cycleLabel)}
              {...register("cycleLabel")}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            {RATING_FIELDS.map((field, index) => (
              <Field
                key={field.name}
                label={field.label}
                error={errors[field.name]?.message}
              >
                <Select
                  value={String(watch(field.name))}
                  onValueChange={(v) =>
                    setValue(field.name, Number(v ?? 3), { shouldValidate: true })
                  }
                >
                  <SelectTrigger
                    id={`fb-rate-${index}`}
                    className="w-full"
                    aria-invalid={Boolean(errors[field.name])}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} / 5
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ))}
          </div>

          <Field label="Strengths" error={errors.strengths?.message}>
            <Textarea
              id="fb-strengths"
              rows={2}
              placeholder="Optional — what they did well"
              {...register("strengths")}
            />
          </Field>

          <Field label="Improvement areas" error={errors.improvementAreas?.message}>
            <Textarea
              id="fb-improvements"
              rows={2}
              placeholder="Optional — what to work on"
              {...register("improvementAreas")}
            />
          </Field>

          {serverError ? <FormError message={serverError} /> : null}

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : (
                "Create draft"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Row actions ────────────────────────────────────────────────────────────

/**
 * Per-row: generate AI draft, edit + finalize, open detail. The AI draft
 * button surfaces the API's honest 503/429 message when generation fails —
 * it never falls back to invented prose.
 */
export function FeedbackRowActions({
  feedback,
  canUpdate,
  canApprove,
}: {
  feedback: FeedbackDto;
  canUpdate: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const editable = feedback.status !== "FINALIZED";

  async function handleGenerate() {
    setBusy(true);
    try {
      const response = await fetch(`/api/feedback/${feedback.id}/ai-draft`, {
        method: "POST",
      });

      if (!response.ok) {
        // 503 (provider unconfigured) / 429 (budget) — show the real message.
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        toast.error(data?.message ?? "Unable to generate the AI draft.");
        return;
      }

      toast.success("AI draft generated.");
      router.refresh();
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {canUpdate && editable ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-violet-600 hover:bg-violet-100 hover:text-violet-700"
          onClick={handleGenerate}
          disabled={busy}
          title="Generate AI draft"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="size-4" aria-hidden />
          )}
          <span className="sr-only">
            {busy ? "Drafting…" : `Generate AI draft for ${feedback.cycleLabel}`}
          </span>
        </Button>
      ) : null}

      {canApprove && editable ? (
        <ApproveFeedbackButton feedback={feedback} />
      ) : null}

      <Button
        variant="ghost"
        size="icon-sm"
        render={<Link href={`/feedback/${feedback.id}`} />}
        title="Open detail"
      >
        <ExternalLink className="size-4" aria-hidden />
        <span className="sr-only">Open feedback detail</span>
      </Button>
    </div>
  );
}

/**
 * Edit + finalize in one dialog: the final text starts from the AI draft (or
 * the last saved text) and the reviewer makes it theirs before approving.
 */
function ApproveFeedbackButton({ feedback }: { feedback: FeedbackDto }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setFinalText(feedback.aiDraft ?? feedback.finalText ?? "");
      setServerError(null);
    }
  }

  async function handleApprove() {
    setBusy(true);
    setServerError(null);
    try {
      const response = await fetch(`/api/feedback/${feedback.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalText }),
      });

      if (!response.ok) {
        // 400 on empty text — the API's message says exactly what is missing.
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setServerError(data?.message ?? "Unable to finalize the feedback.");
        return;
      }

      setOpen(false);
      toast.success("Feedback finalized.");
      router.refresh();
    } catch {
      setServerError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700"
        onClick={() => handleOpenChange(true)}
        title="Edit & finalize"
      >
        <Check className="size-4" aria-hidden />
        <span className="sr-only">Edit and finalize feedback</span>
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit &amp; finalize</DialogTitle>
            <DialogDescription>
              {feedback.employee?.fullName ?? "Employee"} · {feedback.cycleLabel}.
              Employees see this text verbatim. Finalizing makes the review
              immutable.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="fb-final-text">Final text</Label>
            <Textarea
              id="fb-final-text"
              rows={8}
              value={finalText}
              onChange={(e) => setFinalText(e.target.value)}
              aria-invalid={Boolean(serverError)}
            />
            <p className="text-xs text-muted-foreground">
              Employees see this text verbatim.
            </p>
          </div>

          {serverError ? <FormError message={serverError} /> : null}

          <DialogFooter showCloseButton>
            <Button onClick={handleApprove} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Finalizing…
                </>
              ) : (
                "Finalize feedback"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Detail-page actions ────────────────────────────────────────────────────

/**
 * "Generate draft" for the detail page. The 503/429 message is rendered
 * INLINE and persistently (not a toast) so an unconfigured AI provider or an
 * exhausted budget stays visible until resolved.
 */
export function GenerateDraftButton({
  feedbackId,
  cycleLabel,
}: {
  feedbackId: string;
  cycleLabel: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/feedback/${feedbackId}/ai-draft`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setError(data?.message ?? "Unable to generate the AI draft.");
        return;
      }

      toast.success("AI draft generated.");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button size="sm" onClick={handleGenerate} disabled={busy}>
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Drafting…
          </>
        ) : (
          <>
            <Sparkles className="size-4" aria-hidden />
            Generate draft
          </>
        )}
      </Button>
      {error ? <FormError message={error} /> : null}
      <span className="sr-only">Generate AI draft for {cycleLabel}</span>
    </div>
  );
}

/**
 * Final-text editor for an editable review: Save draft (PATCH) keeps work in
 * progress; Approve (POST) finalizes. Both show the API's message on failure.
 */
export function FeedbackFinalTextEditor({
  feedback,
  canUpdate,
  canApprove,
}: {
  feedback: FeedbackDto;
  canUpdate: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [finalText, setFinalText] = useState(
    feedback.finalText ?? feedback.aiDraft ?? "",
  );
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "approve" | null>(null);

  async function submit(intent: "save" | "approve") {
    setBusy(intent);
    setServerError(null);

    const url =
      intent === "approve"
        ? `/api/feedback/${feedback.id}/approve`
        : `/api/feedback/${feedback.id}`;
    const method = intent === "approve" ? "POST" : "PATCH";

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalText }),
      });

      if (!response.ok) {
        // 400 on empty text and 409 on FINALIZED both arrive here verbatim.
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setServerError(
          data?.message ??
            (intent === "approve"
              ? "Unable to finalize the feedback."
              : "Unable to save the draft."),
        );
        return;
      }

      toast.success(intent === "approve" ? "Feedback finalized." : "Draft saved.");
      router.refresh();
    } catch {
      setServerError("Network error. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <Label htmlFor="fb-detail-final">Final text</Label>
      <Textarea
        id="fb-detail-final"
        rows={8}
        value={finalText}
        onChange={(e) => setFinalText(e.target.value)}
        aria-invalid={Boolean(serverError)}
      />
      <p className="text-xs text-muted-foreground">
        Employees see this text verbatim once finalized.
      </p>

      {serverError ? <FormError message={serverError} /> : null}

      <div className="flex items-center gap-2">
        {canUpdate ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => submit("save")}
            disabled={busy !== null}
          >
            {busy === "save" ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : (
              "Save draft"
            )}
          </Button>
        ) : null}
        {canApprove ? (
          <Button size="sm" onClick={() => submit("approve")} disabled={busy !== null}>
            {busy === "approve" ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Finalizing…
              </>
            ) : (
              "Finalize feedback"
            )}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
