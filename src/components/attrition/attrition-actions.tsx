"use client";

/**
 * Attrition mutation UI: run batch predictions (ADMIN/HR), edit an employee's
 * indicator row (ADMIN/HR), plus the risk-distribution chart.
 *
 * The honest-absence rule: when no trained model exists the API answers 503
 * ATTRITION_MODEL_MISSING and we show that message — in the dialog AND as a
 * persistent callout above the table (via ?modelMissing=1, which the server
 * page renders). We never invent a score to make the dashboard look populated;
 * fabricated risk numbers about real people's jobs would be the worst possible
 * failure mode.
 */
import * as React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Pencil, Play } from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
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
import type { AttritionIndicatorDto, AttritionRunResult } from "@/lib/services/attrition";
import type { RiskCategory } from "@/generated/prisma/enums";

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

// ─── Run predictions ────────────────────────────────────────────────────────

/**
 * Header/empty-state action: confirm, then POST /api/attrition/run.
 *
 * On 503 ATTRITION_MODEL_MISSING the API's message stays visible in the open
 * dialog and the page is switched to ?modelMissing=1 so the server renders the
 * amber "no model trained yet" callout above the table — an honest, persistent
 * state rather than a transient toast.
 */
export function RunPredictionsButton({
  canRun,
  variant = "sm",
}: {
  canRun: boolean;
  variant?: "sm" | "empty";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canRun) return null;

  function urlWithModelMissing(value: boolean): string {
    const search = new URLSearchParams(window.location.search);
    if (value) search.set("modelMissing", "1");
    else search.delete("modelMissing");
    const qs = search.toString();
    return qs ? `/attrition?${qs}` : "/attrition";
  }

  async function handleRun() {
    setBusy(true);
    setServerError(null);
    try {
      const response = await fetch("/api/attrition/run", { method: "POST" });
      const data = (await response.json().catch(() => null)) as
        | (ApiErrorBody & Partial<AttritionRunResult>)
        | null;

      if (!response.ok) {
        if (data?.code === "ATTRITION_MODEL_MISSING") {
          // Honest state: persist it on the page, not just in this dialog.
          setServerError(
            data.message ??
              "No trained attrition model found. Train one with scripts/train-attrition.py and place models/attrition-model.json.",
          );
          router.replace(urlWithModelMissing(true));
          return;
        }
        setServerError(data?.message ?? "Unable to run predictions.");
        return;
      }

      if (data && typeof data.processed === "number") {
        toast.success(
          `Processed ${data.processed} — HIGH ${data.high ?? 0}, MEDIUM ${
            data.medium ?? 0
          }, LOW ${data.low ?? 0}`,
        );
      } else {
        toast.success("Predictions run complete.");
      }
      setOpen(false);
      router.replace(urlWithModelMissing(false));
      router.refresh();
    } catch {
      setServerError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (variant === "empty") {
    return (
      <>
        <Button onClick={() => { setServerError(null); setOpen(true); }}>
          <Play className="size-4" aria-hidden />
          Run predictions
        </Button>
        <RunDialog
          open={open}
          onOpenChange={setOpen}
          busy={busy}
          serverError={serverError}
          onRun={handleRun}
        />
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Play className="size-4" aria-hidden />
            Run predictions
          </Button>
        }
      />
      <RunDialogBody
        busy={busy}
        serverError={serverError}
        onRun={handleRun}
      />
    </Dialog>
  );
}

function RunDialog({
  open,
  onOpenChange,
  busy,
  serverError,
  onRun,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  serverError: string | null;
  onRun: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <RunDialogBody busy={busy} serverError={serverError} onRun={onRun} />
      </DialogContent>
    </Dialog>
  );
}

function RunDialogBody({
  busy,
  serverError,
  onRun,
}: {
  busy: boolean;
  serverError: string | null;
  onRun: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Run attrition predictions?</DialogTitle>
        <DialogDescription>
          Scores every ACTIVE employee with the trained model and replaces their
          stored signal. Estimates are decision support only — never grounds for
          automated employment actions.
        </DialogDescription>
      </DialogHeader>

      {serverError ? (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {serverError}
        </div>
      ) : null}

      <DialogFooter showCloseButton>
        <Button onClick={onRun} disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Running…
            </>
          ) : (
            "Run predictions"
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

// ─── Edit indicators ────────────────────────────────────────────────────────

/** Mirrors src/lib/validation/attrition.ts indicatorUpsertSchema. */
const scale5 = (label: string) =>
  z
    .number({ message: `${label} is required.` })
    .int(`${label} must be a whole number.`)
    .min(1, `${label} must be at least 1.`)
    .max(5, `${label} must be 5 or fewer.`);

const count50 = (label: string) =>
  z
    .number({ message: `${label} is required.` })
    .int(`${label} must be a whole number.`)
    .min(0, `${label} must not be negative.`)
    .max(50, `${label} must be 50 or fewer.`);

const indicatorSchema = z.object({
  overtime: z.boolean({ message: "Overtime must be true or false." }),
  jobSatisfaction: scale5("Job satisfaction"),
  workLifeBalance: scale5("Work-life balance"),
  environmentSatisfaction: scale5("Environment satisfaction"),
  trainingTimesLastYear: count50("Training times last year"),
  yearsSinceLastPromotion: count50("Years since last promotion"),
});

type IndicatorValues = z.infer<typeof indicatorSchema>;

/** The 1-5 satisfaction scales, rendered as selects. */
const SCALE_FIELDS = [
  { name: "jobSatisfaction", label: "Job satisfaction" },
  { name: "workLifeBalance", label: "Work-life balance" },
  { name: "environmentSatisfaction", label: "Environment satisfaction" },
] as const;

function defaultsFor(indicator?: AttritionIndicatorDto): IndicatorValues {
  return {
    overtime: indicator?.overtime ?? false,
    jobSatisfaction: indicator?.jobSatisfaction ?? 3,
    workLifeBalance: indicator?.workLifeBalance ?? 3,
    environmentSatisfaction: indicator?.environmentSatisfaction ?? 3,
    trainingTimesLastYear: indicator?.trainingTimesLastYear ?? 0,
    yearsSinceLastPromotion: indicator?.yearsSinceLastPromotion ?? 0,
  };
}

/** Per-row dialog: edit (or create) the model's input row for one employee. */
export function EditIndicatorsButton({
  employeeId,
  employeeName,
  indicator,
  canUpdate,
}: {
  employeeId: string;
  employeeName: string;
  indicator: AttritionIndicatorDto | undefined;
  canUpdate: boolean;
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
  } = useForm<IndicatorValues>({
    resolver: zodResolver(indicatorSchema),
    defaultValues: defaultsFor(indicator),
  });

  if (!canUpdate) return null;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // Re-seed on every open so a cancelled edit can't leak stale values.
      reset(defaultsFor(indicator));
      setServerError(null);
    }
  }

  async function onSubmit(values: IndicatorValues) {
    setServerError(null);
    try {
      const response = await fetch("/api/attrition/indicators", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, ...values }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setServerError(data?.message ?? "Unable to save the indicators.");
        return;
      }

      setOpen(false);
      toast.success(`Indicators saved for ${employeeName}.`);
      router.refresh();
    } catch {
      setServerError("Network error. Please try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon-sm" title="Edit indicators">
            <Pencil className="size-4" aria-hidden />
            <span className="sr-only">Edit indicators for {employeeName}</span>
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Indicators — {employeeName}</DialogTitle>
          <DialogDescription>
            {indicator
              ? "The model's current inputs for this employee. Saving does not rescore them — run predictions again."
              : "No indicator row exists yet — this creates one. Run predictions again to rescore."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="flex items-center gap-2">
            <input
              id="attr-overtime"
              type="checkbox"
              className="size-4 rounded border-input"
              aria-invalid={Boolean(errors.overtime)}
              {...register("overtime")}
            />
            <Label htmlFor="attr-overtime">Works overtime</Label>
            {errors.overtime ? (
              <p className="text-sm text-destructive">{errors.overtime.message}</p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {SCALE_FIELDS.map((field) => (
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
                    id={`attr-${field.name}`}
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

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Training times last year" error={errors.trainingTimesLastYear?.message}>
              <Input
                id="attr-training"
                type="number"
                min={0}
                max={50}
                aria-invalid={Boolean(errors.trainingTimesLastYear)}
                {...register("trainingTimesLastYear", { valueAsNumber: true })}
              />
            </Field>
            <Field label="Years since last promotion" error={errors.yearsSinceLastPromotion?.message}>
              <Input
                id="attr-promo"
                type="number"
                min={0}
                max={50}
                aria-invalid={Boolean(errors.yearsSinceLastPromotion)}
                {...register("yearsSinceLastPromotion", { valueAsNumber: true })}
              />
            </Field>
          </div>

          {serverError ? <FormError message={serverError} /> : null}

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : (
                "Save indicators"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Risk distribution chart ────────────────────────────────────────────────

const RISK_COLOR: Record<RiskCategory, string> = {
  HIGH: "#f43f5e", // rose
  MEDIUM: "#f59e0b", // amber
  LOW: "#10b981", // emerald
};

export type RiskDatum = { category: RiskCategory; count: number };

/** BarChart of risk counts per category — data comes from loaded signal rows. */
export function RiskDistributionChart({ data }: { data: RiskDatum[] }) {
  return (
    <ChartContainer
      config={{
        HIGH: { label: "High", color: RISK_COLOR.HIGH },
        MEDIUM: { label: "Medium", color: RISK_COLOR.MEDIUM },
        LOW: { label: "Low", color: RISK_COLOR.LOW },
      }}
      className="h-[240px] w-full"
    >
      <BarChart data={data} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
        <XAxis
          dataKey="category"
          tickLine={false}
          axisLine={false}
          stroke="var(--muted-foreground)"
          fontSize={12}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          stroke="var(--muted-foreground)"
          fontSize={12}
        />
        <ChartTooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltipContent />} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((datum) => (
            <Cell key={datum.category} fill={RISK_COLOR[datum.category]} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
