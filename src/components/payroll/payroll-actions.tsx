"use client";

/**
 * Payroll mutation UI: generate a DRAFT, edit its bonus/deduction, finalize.
 *
 * Money never passes through JS arithmetic here — fields are submitted as raw
 * text and the server normalizes them to exact decimal strings before any
 * math. FINAL rows are immutable, so the edit and finalize controls only ever
 * appear on DRAFT records; the service refuses the write regardless.
 */
import * as React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, Loader2, Lock, Pencil, Plus } from "lucide-react";
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
import type { PayrollRecordDto } from "@/lib/dto";

const AMOUNT = /^\d{1,10}(\.\d{1,2})?$/;

/** Mirrors src/lib/validation/payroll.ts createPayrollSchema.
 *
 * `month`/`year` are typed as numbers here (registered with `valueAsNumber`)
 * rather than `z.coerce`, because coerce makes the schema's *input* `unknown`
 * and RHF then can't align its input and output types. The server keeps its
 * own coerce for plain JSON clients.
 */
const generateSchema = z.object({
  employeeId: z.string().min(1, "Pick an employee."),
  month: z
    .number({ message: "Month is required." })
    .int("Month must be an integer.")
    .min(1, "Month must be 1–12.")
    .max(12, "Month must be 1–12."),
  year: z
    .number({ message: "Year is required." })
    .int("Year must be an integer.")
    .min(2000, "Year must be 2000–2100.")
    .max(2100, "Year must be 2000–2100."),
  baseSalary: z
    .string()
    .trim()
    .regex(AMOUNT, "Digits, up to 2 decimals.")
    .min(1, "Base salary is required."),
  bonus: z.string().regex(AMOUNT, "Digits, up to 2 decimals.").or(z.literal("")),
  deduction: z.string().regex(AMOUNT, "Digits, up to 2 decimals.").or(z.literal("")),
});

type GenerateValues = z.infer<typeof generateSchema>;

/** `{ update: { … } }` — one or both optional money fields. */
const editSchema = z.object({
  bonus: z.string().regex(AMOUNT, "Digits, up to 2 decimals.").or(z.literal("")),
  deduction: z.string().regex(AMOUNT, "Digits, up to 2 decimals.").or(z.literal("")),
});

type EditValues = z.infer<typeof editSchema>;

type ApiErrorBody = { message?: string };
type EmployeeLite = { id: string; label: string };

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
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

/** Header action: generate one DRAFT record (ADMIN/HR). */
export function GeneratePayrollButton({
  employees,
  canCreate,
}: {
  employees: EmployeeLite[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const now = new Date();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<GenerateValues>({
    resolver: zodResolver(generateSchema),
    defaultValues: {
      employeeId: "",
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      baseSalary: "",
      bonus: "",
      deduction: "",
    },
  });

  if (!canCreate || employees.length === 0) return null;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      const d = new Date();
      reset({
        employeeId: "",
        month: d.getMonth() + 1,
        year: d.getFullYear(),
        baseSalary: "",
        bonus: "",
        deduction: "",
      });
      setServerError(null);
    }
  }

  async function onSubmit(values: GenerateValues) {
    setServerError(null);
    const body: Record<string, unknown> = {
      employeeId: values.employeeId,
      month: values.month,
      year: values.year,
      baseSalary: values.baseSalary,
    };
    // An empty field means "leave unset" — omit rather than send 0.
    if (values.bonus) body.bonus = values.bonus;
    if (values.deduction) body.deduction = values.deduction;

    try {
      const response = await fetch("/api/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setServerError(data?.message ?? "Unable to generate the record.");
        return;
      }

      setOpen(false);
      toast.success("Payroll record generated.");
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
            Generate payroll
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generate payroll</DialogTitle>
          <DialogDescription>
            Creates a DRAFT record for one employee and period. It can be edited
            until finalized; a duplicate period is rejected.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field label="Employee" error={errors.employeeId?.message}>
            <Select
              value={watch("employeeId")}
              onValueChange={(v) => setValue("employeeId", v ?? "", { shouldValidate: true })}
            >
              <SelectTrigger className="w-full">
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

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Month" error={errors.month?.message}>
              <Input
                type="number"
                min={1}
                max={12}
                {...register("month", { valueAsNumber: true })}
              />
            </Field>
            <Field label="Year" error={errors.year?.message}>
              <Input
                type="number"
                min={2000}
                max={2100}
                {...register("year", { valueAsNumber: true })}
              />
            </Field>
          </div>

          <Field
            label="Base salary"
            hint="Exact amount; all totals are computed server-side."
            error={errors.baseSalary?.message}
          >
            <Input inputMode="decimal" placeholder="55000" {...register("baseSalary")} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bonus" error={errors.bonus?.message}>
              <Input inputMode="decimal" placeholder="0" {...register("bonus")} />
            </Field>
            <Field label="Deduction" error={errors.deduction?.message}>
              <Input inputMode="decimal" placeholder="0" {...register("deduction")} />
            </Field>
          </div>

          {serverError ? <FormError message={serverError} /> : null}

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Generating…
                </>
              ) : (
                "Generate record"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Edit bonus/deduction on a DRAFT row (ADMIN/HR). */
export function EditPayrollButton({
  record,
  canUpdate,
}: {
  record: PayrollRecordDto;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { bonus: record.bonus, deduction: record.deduction },
  });

  // FINAL is immutable — no control, and the service refuses the write anyway.
  if (!canUpdate || record.status !== "DRAFT") return null;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      reset({ bonus: record.bonus, deduction: record.deduction });
      setServerError(null);
    }
  }

  async function onSubmit(values: EditValues) {
    setServerError(null);
    const update: Record<string, string> = {};
    if (values.bonus) update.bonus = values.bonus;
    if (values.deduction) update.deduction = values.deduction;

    if (Object.keys(update).length === 0) {
      setServerError("Nothing to update.");
      return;
    }

    try {
      const response = await fetch(`/api/payroll/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ update }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setServerError(data?.message ?? "Unable to update the record.");
        return;
      }

      setOpen(false);
      toast.success("Payroll record updated.");
      router.refresh();
    } catch {
      setServerError("Network error. Please try again.");
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => {
          setServerError(null);
          setOpen(true);
        }}
        title="Edit amounts"
      >
        <Pencil className="size-4" aria-hidden />
        <span className="sr-only">Edit record</span>
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit payroll record</DialogTitle>
            <DialogDescription>
              {record.employee?.fullName ?? "Employee"} · {record.month}/{record.year}.
              Totals recompute from these values.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <Field label="Bonus" error={errors.bonus?.message}>
              <Input inputMode="decimal" {...register("bonus")} />
            </Field>
            <Field label="Deduction" error={errors.deduction?.message}>
              <Input inputMode="decimal" {...register("deduction")} />
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
                  "Save changes"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Finalize a DRAFT (ADMIN/HR). One-way: the service flips DRAFT → FINAL and
 * every later write is refused, so this confirms first.
 */
export function FinalizePayrollButton({
  record,
  canUpdate,
}: {
  record: PayrollRecordDto;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canUpdate || record.status !== "DRAFT") return null;

  async function handleFinalize() {
    setBusy(true);
    setServerError(null);
    try {
      const response = await fetch(`/api/payroll/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalize: true }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setServerError(data?.message ?? "Unable to finalize the record.");
        return;
      }

      setOpen(false);
      toast.success("Payroll record finalized.");
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
        onClick={() => {
          setServerError(null);
          setOpen(true);
        }}
        title="Finalize"
      >
        <Check className="size-4" aria-hidden />
        <span className="sr-only">Finalize record</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finalize this record?</DialogTitle>
            <DialogDescription>
              {record.employee?.fullName ?? "Employee"} · {record.month}/{record.year} ·{" "}
              {record.netPay} net. Finalized records are locked permanently.
            </DialogDescription>
          </DialogHeader>

          {serverError ? <FormError message={serverError} /> : null}

          <DialogFooter showCloseButton>
            <Button disabled={busy} onClick={handleFinalize}>
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Finalizing…
                </>
              ) : (
                <>
                  <Lock className="size-4" aria-hidden />
                  Finalize
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Period/status badge for the payroll table. */
export function PayrollStatusBadge({ status }: { status: PayrollRecordDto["status"] }) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        status === "FINAL"
          ? "bg-emerald-100 text-emerald-800"
          : "bg-slate-100 text-slate-600",
      ].join(" ")}
    >
      {status}
    </span>
  );
}
