"use client";

/**
 * Leave mutation UI: submit (EMPLOYEE), decide (ADMIN/HR) and cancel (owner).
 *
 * The PATCH body differs per intent — `{ decision }` to approve/reject,`
 * `{ action: "CANCEL" }` to withdraw — matching the server's discriminated
 * union. Permission flags are computed server-side and passed down as UX
 * gating only; the service re-asserts on every request, including the
 * self-decision ban, which the client cannot enforce and never tries to.
 */
import * as React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Ban, Loader2, Plus, ThumbsDown, ThumbsUp } from "lucide-react";
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
import type { LeaveRequestDto, LeaveType } from "@/lib/dto";

/** Mirrors src/lib/validation/leave.ts submitLeaveSchema. */
const submitSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be YYYY-MM-DD."),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be YYYY-MM-DD."),
    type: z.enum(["ANNUAL", "SICK", "UNPAID", "MATERNITY", "PATERNITY", "OTHER"]),
    reason: z
      .string()
      .trim()
      .min(5, "Reason must be at least 5 characters.")
      .max(500, "Reason must be 500 characters or fewer."),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "End date cannot be before the start date.",
    path: ["endDate"],
  });

type SubmitValues = z.infer<typeof submitSchema>;
type ApiErrorBody = { message?: string };

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
  id,
  error,
  children,
}: {
  label: string;
  /** Explicit id shared with the control inside, so <Label htmlFor> actually points at it. */
  id: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-sm text-destructive" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Header action: submit a request. EMPLOYEE only (flag from the server). */
export function SubmitLeaveButton({ canCreate }: { canCreate: boolean }) {
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
  } = useForm<SubmitValues>({
    resolver: zodResolver(submitSchema),
    defaultValues: {
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date().toISOString().slice(0, 10),
      type: "ANNUAL",
      reason: "",
    },
  });

  if (!canCreate) return null;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      reset({
        startDate: new Date().toISOString().slice(0, 10),
        endDate: new Date().toISOString().slice(0, 10),
        type: "ANNUAL",
        reason: "",
      });
      setServerError(null);
    }
  }

  async function onSubmit(values: SubmitValues) {
    setServerError(null);
    try {
      const response = await fetch("/api/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setServerError(data?.message ?? "Unable to submit the request.");
        return;
      }

      setOpen(false);
      toast.success("Leave request submitted.");
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
            Request leave
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request leave</DialogTitle>
          <DialogDescription>
            Your manager reviews it. You can withdraw it while it is pending.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First day" id="leave-start-date" error={errors.startDate?.message}>
              <Input type="date" id="leave-start-date" {...register("startDate")} />
            </Field>
            <Field label="Last day" id="leave-end-date" error={errors.endDate?.message}>
              <Input type="date" id="leave-end-date" {...register("endDate")} />
            </Field>
          </div>

          <Field label="Type" id="leave-type" error={errors.type?.message}>
            <Select
              value={watch("type")}
              onValueChange={(v) => setValue("type", v as LeaveType, { shouldValidate: true })}
            >
              <SelectTrigger className="w-full" id="leave-type" aria-describedby={errors.type ? "leave-type-error" : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ANNUAL">Annual</SelectItem>
                <SelectItem value="SICK">Sick</SelectItem>
                <SelectItem value="UNPAID">Unpaid</SelectItem>
                <SelectItem value="MATERNITY">Maternity</SelectItem>
                <SelectItem value="PATERNITY">Paternity</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Reason" id="leave-reason-submit" error={errors.reason?.message}>
            <Textarea
              id="leave-reason-submit"
              rows={3}
              placeholder="Why are you away?"
              {...register("reason")}
            />
          </Field>

          {serverError ? <FormError message={serverError} /> : null}

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Submitting…
                </>
              ) : (
                "Submit request"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Decision = "APPROVED" | "REJECTED";

/**
 * Approve / reject for ADMIN/HR. Both are PATCHes carrying a `decision` key,
 * which the server tags as the "decision" intent.
 */
export function DecideLeaveButtons({
  request,
  canApprove,
}: {
  request: LeaveRequestDto;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Decision | null>(null);
  const [reason, setReason] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canApprove || request.status !== "PENDING") return null;

  async function submit(decision: Decision) {
    // Mirror the server rule for instant feedback; the server enforces it
    // regardless, so this is UX only, never the security boundary.
    if (decision === "REJECTED" && !reason.trim()) {
      setServerError("A reason is required when rejecting a leave request.");
      return;
    }
    setBusy(true);
    setServerError(null);
    try {
      const response = await fetch(`/api/leave/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Omit an empty reason rather than sending "".
        body: JSON.stringify(
          reason.trim() ? { decision, decisionReason: reason.trim() } : { decision },
        ),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setServerError(data?.message ?? "Unable to record the decision.");
        return;
      }

      setOpen(null);
      setReason("");
      toast.success(`Request ${decision.toLowerCase()}.`);
      router.refresh();
    } catch {
      setServerError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700"
        onClick={() => {
          setReason("");
          setServerError(null);
          setOpen("APPROVED");
        }}
        title="Approve"
      >
        <ThumbsUp className="size-4" aria-hidden />
        <span className="sr-only">Approve request</span>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => {
          setReason("");
          setServerError(null);
          setOpen("REJECTED");
        }}
        title="Reject"
      >
        <ThumbsDown className="size-4" aria-hidden />
        <span className="sr-only">Reject request</span>
      </Button>

      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {open === "APPROVED" ? "Approve" : "Reject"} this request?
            </DialogTitle>
            <DialogDescription>
              {request.startDate} → {request.endDate} · {request.type} · {request.days} day
              {request.days === 1 ? "" : "s"}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="leave-reason">
              Reason{" "}
              {open === "REJECTED" ? (
                <span className="text-destructive">(required)</span>
              ) : (
                "(optional)"
              )}
            </Label>
            <Textarea
              id="leave-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Shown to the employee"
              aria-required={open === "REJECTED" || undefined}
            />
          </div>

          {serverError ? <FormError message={serverError} /> : null}

          <DialogFooter showCloseButton>
            <Button
              variant={open === "REJECTED" ? "destructive" : "default"}
              disabled={busy}
              onClick={() => open && submit(open)}
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : open === "APPROVED" ? (
                "Approve"
              ) : (
                "Reject"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Owner-only withdraw, offered while the request is still pending. */
export function CancelLeaveButton({
  request,
  canCancel,
}: {
  request: LeaveRequestDto;
  canCancel: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canCancel || request.status !== "PENDING") return null;

  async function handleCancel() {
    setBusy(true);
    setServerError(null);
    try {
      const response = await fetch(`/api/leave/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CANCEL" }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setServerError(data?.message ?? "Unable to withdraw the request.");
        return;
      }

      setOpen(false);
      toast.success("Request withdrawn.");
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
        onClick={() => {
          setServerError(null);
          setOpen(true);
        }}
        title="Withdraw"
      >
        <Ban className="size-4" aria-hidden />
        <span className="sr-only">Withdraw request</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw this request?</DialogTitle>
            <DialogDescription>
              It will be cancelled. You can submit a new request afterwards.
            </DialogDescription>
          </DialogHeader>

          {serverError ? <FormError message={serverError} /> : null}

          <DialogFooter showCloseButton>
            <Button variant="destructive" disabled={busy} onClick={handleCancel}>
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Withdrawing…
                </>
              ) : (
                "Withdraw request"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Status badge shared by the leave table and approvals queue. */
export function LeaveStatusBadge({ status }: { status: LeaveRequestDto["status"] }) {
  const style: Record<LeaveRequestDto["status"], string> = {
    PENDING: "bg-amber-100 text-amber-800",
    APPROVED: "bg-emerald-100 text-emerald-800",
    REJECTED: "bg-rose-100 text-rose-800",
    CANCELLED: "bg-slate-100 text-slate-600",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style[status]}`}
    >
      {status}
    </span>
  );
}
