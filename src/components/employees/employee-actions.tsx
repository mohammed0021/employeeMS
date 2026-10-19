"use client";

/**
 * Employee mutation UI: create, edit, deactivate and delete.
 *
 * Reads stay server-rendered (the page calls the service directly); only
 * mutations cross the network, then `router.refresh()` re-runs the server
 * render. Permission flags are computed server-side via `can()` and passed
 * down — UX gating only; the API re-checks every request.
 *
 * Salary is gated identically to the server (`canSeeSalary`), because the DTO
 * hands EMPLOYEE a null — the client mirrors that so it never renders an empty
 * money field as if it were "0".
 */
import * as React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Controller,
  useForm,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link2, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { canSeeSalary, type EmployeeDto } from "@/lib/dto";
import type { Role } from "@/lib/auth/permissions";

type ApiErrorBody = { message?: string };

/** Mirrors src/lib/validation/createEmployeeSchema for instant field feedback. */
export const employeeSchema = z.object({
  employeeCode: z.string().trim().min(2, "Code must be at least 2 characters.").max(40),
  firstName: z.string().trim().min(1, "First name is required.").max(80),
  lastName: z.string().trim().min(1, "Last name is required.").max(80),
  email: z.string().trim().min(3).max(254).email("Enter a valid email address."),
  phone: z.string().trim().max(40),
  position: z.string().trim().min(1, "Position is required.").max(120),
  joinDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Join date must be YYYY-MM-DD.")
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Not a valid date."),
  salary: z
    .string()
    .trim()
    .min(1, "Salary is required.")
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "Digits, up to 2 decimals."),
  departmentId: z.string().min(1, "Pick a department."),
  status: z.enum(["ACTIVE", "INACTIVE", "ON_LEAVE"]),
});

export type EmployeeFormValues = z.infer<typeof employeeSchema>;

export type DepartmentOption = { id: string; name: string };

export function defaultsFor(employee?: EmployeeDto): EmployeeFormValues {
  return {
    employeeCode: employee?.employeeCode ?? "",
    firstName: employee?.firstName ?? "",
    lastName: employee?.lastName ?? "",
    email: employee?.email ?? "",
    phone: employee?.phone ?? "",
    position: employee?.position ?? "",
    joinDate: employee?.joinDate ?? new Date().toISOString().slice(0, 10),
    salary: employee?.salary ?? "",
    departmentId: employee?.department?.id ?? "",
    status: employee?.status ?? "ACTIVE",
  };
}

/**
 * The one place an employee form talks to the API. Both the dialog and the
 * full-page create/edit forms call this, so the create-vs-patch rules — phone
 * clears on edit but is omitted when blank on create, salary only when the
 * viewer may see it, status sent only on a real change — stay in one spot
 * rather than drifting between two copies.
 */
export async function submitEmployee(
  values: EmployeeFormValues,
  opts: { employee?: EmployeeDto; showSalary: boolean },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { employee, showSalary } = opts;
  const isEdit = Boolean(employee);

  const body: Record<string, unknown> = {
    employeeCode: values.employeeCode,
    firstName: values.firstName,
    lastName: values.lastName,
    email: values.email,
    position: values.position,
    joinDate: values.joinDate,
    departmentId: values.departmentId,
  };
  if (isEdit) body.phone = values.phone === "" ? null : values.phone;
  else if (values.phone !== "") body.phone = values.phone;
  if (showSalary) body.salary = values.salary;
  if (!isEdit || values.status !== employee?.status) body.status = values.status;

  try {
    const response = await fetch(
      isEdit ? `/api/employees/${employee?.id}` : "/api/employees",
      {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
      return {
        ok: false,
        message: data?.message ?? (isEdit ? "Unable to update." : "Unable to create."),
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Network error. Please try again." };
  }
}

function EmployeeFormDialog({
  employee,
  departments,
  role,
  trigger,
}: {
  employee?: EmployeeDto;
  departments: DepartmentOption[];
  role: Role;
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const isEdit = Boolean(employee);
  const showSalary = canSeeSalary(role);

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: defaultsFor(employee),
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      reset(defaultsFor(employee));
      setServerError(null);
    }
  }

  async function onSubmit(values: EmployeeFormValues) {
    setServerError(null);
    const result = await submitEmployee(values, { employee, showSalary });
    if (!result.ok) {
      setServerError(result.message);
      return;
    }

    setOpen(false);
    toast.success(isEdit ? "Employee updated." : "Employee created.");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button />}>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit employee" : "New employee"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this employee's record."
              : "Add someone to the directory."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <EmployeeFieldGrid
            control={control}
            register={register}
            errors={errors}
            departments={departments}
            showSalary={showSalary}
          />

          {serverError ? <FormError message={serverError} /> : null}

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : isEdit ? (
                "Save changes"
              ) : (
                "Create employee"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The employee form's inputs as a `<Controller>`-driven grid. Exported so the
 * dialog and the full-page create/edit forms render identical fields without
 * duplicating the markup (and without either copy drifting on validation).
 */
export function EmployeeFieldGrid({
  control,
  register,
  errors,
  departments,
  showSalary,
}: {
  control: Control<EmployeeFormValues>;
  register: UseFormRegister<EmployeeFormValues>;
  errors: FieldErrors<EmployeeFormValues>;
  departments: DepartmentOption[];
  showSalary: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Employee code" error={errors.employeeCode?.message}>
        <Input id="emp-code" placeholder="EMP-013" {...register("employeeCode")} />
      </Field>
      <Field label="Position" error={errors.position?.message}>
        <Input id="emp-pos" placeholder="Engineer" {...register("position")} />
      </Field>
      <Field label="First name" error={errors.firstName?.message}>
        <Input id="emp-first" {...register("firstName")} />
      </Field>
      <Field label="Last name" error={errors.lastName?.message}>
        <Input id="emp-last" {...register("lastName")} />
      </Field>
      <Field label="Email" error={errors.email?.message}>
        <Input id="emp-email" type="email" {...register("email")} />
      </Field>
      <Field label="Phone" error={errors.phone?.message}>
        <Input id="emp-phone" {...register("phone")} />
      </Field>
      <Field label="Join date" error={errors.joinDate?.message}>
        <Input id="emp-join" type="date" {...register("joinDate")} />
      </Field>
      <Controller
        control={control}
        name="status"
        render={({ field, fieldState }) => (
          <Field label="Status" error={fieldState.error?.message}>
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="emp-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                <SelectItem value="ON_LEAVE">ON_LEAVE</SelectItem>
                <SelectItem value="INACTIVE">INACTIVE</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}
      />
      <Controller
        control={control}
        name="departmentId"
        render={({ field, fieldState }) => (
          <Field label="Department" error={fieldState.error?.message}>
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="emp-dept" className="w-full">
                <SelectValue placeholder="Pick a department" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      />
      {showSalary ? (
        <Field label="Salary" error={errors.salary?.message}>
          <Input id="emp-salary" inputMode="decimal" {...register("salary")} />
        </Field>
      ) : null}
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

/**
 * Full-page create/edit form, shared by /employees/new and /employees/[id]/edit.
 *
 * It reuses `EmployeeFieldGrid` and `submitEmployee`, so a page edit and a
 * dialog edit hit the exact same validation and the same POST/PATCH rules —
 * there is no second implementation to drift.
 */
export function EmployeeForm({
  employee,
  departments,
  showSalary,
}: {
  employee?: EmployeeDto;
  departments: DepartmentOption[];
  showSalary: boolean;
}) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const isEdit = Boolean(employee);

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: defaultsFor(employee),
  });

  async function onSubmit(values: EmployeeFormValues) {
    setServerError(null);
    const result = await submitEmployee(values, { employee, showSalary });
    if (!result.ok) {
      setServerError(result.message);
      return;
    }
    toast.success(isEdit ? "Employee updated." : "Employee created.");
    // Land back on the record just written rather than a stale list.
    router.push(employee ? `/employees/${employee.id}` : "/employees");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl space-y-6" noValidate>
      <EmployeeFieldGrid
        control={control}
        register={register}
        errors={errors}
        departments={departments}
        showSalary={showSalary}
      />

      {serverError ? <FormError message={serverError} /> : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Saving…
            </>
          ) : isEdit ? (
            "Save changes"
          ) : (
            "Create employee"
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push(employee ? `/employees/${employee.id}` : "/employees")}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Header action: create (ADMIN/HR). */
export function NewEmployeeButton({
  canCreate,
  departments,
  role,
}: {
  canCreate: boolean;
  departments: DepartmentOption[];
  role: Role;
}) {
  if (!canCreate) return null;
  return (
    <EmployeeFormDialog
      departments={departments}
      role={role}
      trigger={
        <>
          <Plus className="size-4" aria-hidden />
          New employee
        </>
      }
    />
  );
}

/** Per-row edit + deactivate + delete. */
export function EmployeeRowActions({
  employee,
  canUpdate,
  canDelete,
  departments,
  role,
}: {
  employee: EmployeeDto;
  canUpdate: boolean;
  canDelete: boolean;
  departments: DepartmentOption[];
  role: Role;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canUpdate && !canDelete) return null;

  const isActive = employee.status !== "INACTIVE";

  async function deactivate() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/employees/${employee.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "INACTIVE" }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setError(data?.message ?? "Unable to deactivate.");
        return;
      }
      toast.success(`${employee.fullName} deactivated.`);
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/employees/${employee.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setError(data?.message ?? "Unable to delete.");
        return;
      }
      setConfirmOpen(false);
      toast.success(`${employee.fullName} deleted.`);
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {canUpdate ? (
        <EmployeeFormDialog
          employee={employee}
          departments={departments}
          role={role}
          trigger={
            <>
              <Pencil className="size-4" aria-hidden />
              <span className="sr-only">Edit {employee.fullName}</span>
            </>
          }
        />
      ) : null}

      {canUpdate && isActive ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={deactivate}
          disabled={busy}
          title="Deactivate"
        >
          <Link2 className="size-4" aria-hidden />
          <span className="sr-only">Deactivate {employee.fullName}</span>
        </Button>
      ) : null}

      {canDelete ? (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              setError(null);
              setConfirmOpen(true);
            }}
          >
            <Trash2 className="size-4" aria-hidden />
            <span className="sr-only">Delete {employee.fullName}</span>
          </Button>

          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete {employee.fullName}?</DialogTitle>
                <DialogDescription>
                  This permanently removes the record and fails if they have
                  attendance, leave or payroll history — deactivate instead.
                </DialogDescription>
              </DialogHeader>
              {error ? <FormError message={error} /> : null}
              <DialogFooter showCloseButton>
                <Button variant="destructive" onClick={handleDelete} disabled={busy}>
                  {busy ? "Deleting…" : "Delete employee"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}
