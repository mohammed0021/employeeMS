"use client";

/**
 * Attendance mutation UI: record a new day (ADMIN/HR) and correct an existing
 * row (ADMIN/HR).
 *
 * Time inputs use `HH:MM`, matching `TIME_PATTERN`; the server anchors them to
 * the record's calendar date at UTC. The "check-out must be after check-in"
 * rule is also mirrored here so the common mistake is caught before a round
 * trip — the service re-checks regardless.
 */
import * as React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Pencil, Plus } from "lucide-react";
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
import type { AttendanceDto, AttendanceStatus } from "@/lib/dto";
import type { DepartmentOption } from "@/components/employees/employee-actions";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Employee reference for the record dialog's picker. */
export type EmployeeLite = { id: string; label: string };

/** Shared shape for record + correct; every field optional on correct. */
const baseSchema = z.object({
  employeeId: z.string().min(1, "Pick an employee."),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.")
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Not a valid date."),
  status: z.enum(["PRESENT", "ABSENT", "HALF_DAY", "REMOTE"]),
  checkIn: z
    .string()
    .regex(TIME, "Use HH:MM, 24-hour.")
    .or(z.literal("")),
  checkOut: z
    .string()
    .regex(TIME, "Use HH:MM, 24-hour.")
    .or(z.literal("")),
  note: z.string().trim().max(500, "Note must be 500 characters or fewer."),
});

/** Adds the cross-field ordering rule only when both times are present. */
const recordSchema = baseSchema.refine(
  (v) => !(v.checkIn && v.checkOut) || v.checkOut > v.checkIn,
  { message: "Check-out must be after check-in.", path: ["checkOut"] },
);

type FormValues = z.infer<typeof baseSchema>;
type ApiErrorBody = { message?: string };

function toTime(iso: string | null): string {
  return iso ? iso.slice(11, 16) : "";
}

function defaultsFor(record?: AttendanceDto): FormValues {
  return {
    employeeId: record?.employeeId ?? "",
    date: record?.date ?? new Date().toISOString().slice(0, 10),
    status: record?.status ?? "PRESENT",
    checkIn: record ? toTime(record.checkIn) : "",
    checkOut: record ? toTime(record.checkOut) : "",
    note: record?.note ?? "",
  };
}

function AttendanceDialog({
  record,
  employees,
  trigger,
  title,
}: {
  record?: AttendanceDto;
  employees: EmployeeLite[];
  trigger: React.ReactNode;
  title: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const isEdit = Boolean(record);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(isEdit ? baseSchema : recordSchema),
    defaultValues: defaultsFor(record),
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      reset(defaultsFor(record));
      setServerError(null);
    }
  }

  async function onSubmit(values: FormValues) {
    setServerError(null);
    // Empty string means "leave blank" — omit so a correction clears it.
    const body: Record<string, unknown> = { status: values.status };
    if (!isEdit) {
      body.employeeId = values.employeeId;
      body.date = values.date;
    }
    if (values.checkIn) body.checkIn = values.checkIn;
    else if (isEdit) body.checkIn = null;
    if (values.checkOut) body.checkOut = values.checkOut;
    else if (isEdit) body.checkOut = null;
    if (values.note) body.note = values.note;
    else if (isEdit) body.note = null;

    try {
      const response = await fetch(
        isEdit ? `/api/attendance/${record?.id}` : "/api/attendance",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setServerError(data?.message ?? "Unable to save the record.");
        return;
      }

      setOpen(false);
      toast.success(isEdit ? "Record corrected." : "Attendance recorded.");
      router.refresh();
    } catch {
      setServerError("Network error. Please try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button />}>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Correct this day's times or status."
              : "Log a single employee's attendance for one date."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {!isEdit ? (
            <Field label="Employee" error={errors.employeeId?.message}>
              <Select
                value={watch("employeeId")}
                onValueChange={(v) => setValue("employeeId", v ?? "", { shouldValidate: true })}
              >
                <SelectTrigger id="att-emp" className="w-full">
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
          ) : null}

          {!isEdit ? (
            <Field label="Date" error={errors.date?.message}>
              <Input id="att-date" type="date" {...register("date")} />
            </Field>
          ) : null}

          <Field label="Status" error={errors.status?.message}>
            <Select
              value={watch("status")}
              onValueChange={(v) =>
                setValue("status", (v ?? "PRESENT") as AttendanceStatus, {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger id="att-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PRESENT">PRESENT</SelectItem>
                <SelectItem value="ABSENT">ABSENT</SelectItem>
                <SelectItem value="HALF_DAY">HALF_DAY</SelectItem>
                <SelectItem value="REMOTE">REMOTE</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Check-in" error={errors.checkIn?.message}>
              <Input id="att-in" type="time" {...register("checkIn")} />
            </Field>
            <Field label="Check-out" error={errors.checkOut?.message}>
              <Input id="att-out" type="time" {...register("checkOut")} />
            </Field>
          </div>

          <Field label="Note" error={errors.note?.message}>
            <Textarea id="att-note" rows={2} {...register("note")} />
          </Field>

          {serverError ? <FormError message={serverError} /> : null}

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : isEdit ? (
                "Save correction"
              ) : (
                "Record attendance"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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

/** Header action: record a new row. */
export function RecordAttendanceButton({
  employees,
  canCreate,
}: {
  employees: EmployeeLite[];
  canCreate: boolean;
}) {
  if (!canCreate || employees.length === 0) return null;
  return (
    <AttendanceDialog
      employees={employees}
      title="Record attendance"
      trigger={
        <>
          <Plus className="size-4" aria-hidden />
          Record
        </>
      }
    />
  );
}

/** Per-row correction. */
export function CorrectAttendanceButton({
  record,
  canCorrect,
}: {
  record: AttendanceDto;
  canCorrect: boolean;
}) {
  if (!canCorrect) return null;
  return (
    <AttendanceDialog
      record={record}
      employees={[]}
      title="Correct attendance"
      trigger={
        <>
          <Pencil className="size-4" aria-hidden />
          <span className="sr-only">Correct {record.date}</span>
        </>
      }
    />
  );
}

/** Badge shared by the attendance table. */
export function AttendanceStatusBadge({ status }: { status: AttendanceStatus }) {
  const style: Record<AttendanceStatus, string> = {
    PRESENT: "bg-emerald-100 text-emerald-800",
    REMOTE: "bg-sky-100 text-sky-800",
    HALF_DAY: "bg-amber-100 text-amber-800",
    ABSENT: "bg-rose-100 text-rose-800",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style[status]}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}
