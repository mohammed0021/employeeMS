"use client";

/**
 * Admin account mutation UI: create, role/status edit and password reset.
 *
 * Reads stay server-rendered (the users page calls the service directly);
 * only mutations cross the network, then `router.refresh()` re-runs the
 * server render. The page is gated with `pageRole("ADMIN")` — the permission
 * matrix has no "users" resource — and the API re-checks the role anyway.
 *
 * Every failure body is `{code, message}`; the message is surfaced verbatim
 * in the FormError block because it is the only place that explains WHY
 * (last-admin/self-role-change denials, duplicate email, linked employee
 * already having an account).
 */
import * as React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound, Loader2, Pencil, Plus } from "lucide-react";
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
import type { UserDto } from "@/lib/services/admin-users";

type ApiErrorBody = { code?: string; message?: string };

/** Mirrors src/lib/validation/admin.ts (email/role/employeeId/password). */
const ROLES = ["ADMIN", "HR", "EMPLOYEE"] as const;
/** Exact `UserStatus` enum values from prisma/schema.prisma. */
const USER_STATUSES = ["ACTIVE", "DISABLED"] as const;
/** A <SelectItem> needs a real value — "" would render as "unset". */
const NO_EMPLOYEE = "none";

/**
 * Same floor as PASSWORD_POLICY: min 10, max 128, at least one letter and
 * one number — an admin-set password must satisfy the policy the user would.
 */
const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters.")
  .max(128, "Password must be 128 characters or fewer.")
  .regex(/[A-Za-z]/, "Password must include at least one letter.")
  .regex(/[0-9]/, "Password must include at least one number.");

const createUserSchema = z.object({
  email: z
    .string()
    .trim()
    .min(3)
    .max(254)
    .email("Enter a valid email address.")
    .transform((value) => value.toLowerCase()),
  role: z.enum(ROLES),
  password: passwordSchema,
  employeeId: z.string(),
});

const editUserSchema = z.object({
  role: z.enum(ROLES),
  status: z.enum(USER_STATUSES),
});

const resetPasswordSchema = z.object({ password: passwordSchema });

type CreateValues = z.infer<typeof createUserSchema>;
type EditValues = z.infer<typeof editUserSchema>;
type ResetValues = z.infer<typeof resetPasswordSchema>;

/** Picker rows built server-side: "EMP-001 · Jane Doe". */
export type EmployeeOption = { id: string; label: string };

function createDefaults(): CreateValues {
  return { email: "", role: "EMPLOYEE", password: "", employeeId: NO_EMPLOYEE };
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
      {hint && !error ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
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

/** POST /api/admin/users — the only way an account comes into existence. */
function CreateUserDialog({
  employees,
  trigger,
}: {
  employees: EmployeeOption[];
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: createDefaults(),
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      reset(createDefaults());
      setServerError(null);
    }
  }

  async function onSubmit(values: CreateValues) {
    setServerError(null);

    const body: Record<string, unknown> = {
      email: values.email,
      role: values.role,
      password: values.password,
    };
    if (values.employeeId !== NO_EMPLOYEE) body.employeeId = values.employeeId;

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setServerError(data?.message ?? "Unable to create the account.");
        return;
      }

      setOpen(false);
      reset(createDefaults());
      toast.success("User created.");
      router.refresh();
    } catch {
      setServerError("Network error. Please try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button />}>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
          <DialogDescription>
            There is no self-registration — every account is created here by an admin.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field label="Email" error={errors.email?.message}>
            <Input
              id="user-email"
              type="email"
              autoComplete="off"
              placeholder="jane.doe@company.com"
              aria-invalid={Boolean(errors.email)}
              {...register("email")}
            />
          </Field>

          <Controller
            control={control}
            name="role"
            render={({ field, fieldState }) => (
              <Field label="Role" error={fieldState.error?.message}>
                <Select
                  value={field.value}
                  onValueChange={(value) => field.onChange(value ?? field.value)}
                >
                  <SelectTrigger id="user-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />

          <Field
            label="Password"
            hint="Min 10 chars, letter + number. The same policy applies when they sign in."
            error={errors.password?.message}
          >
            <Input
              id="user-password"
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.password)}
              {...register("password")}
            />
          </Field>

          <Controller
            control={control}
            name="employeeId"
            render={({ field }) => (
              <Field label="Linked employee" hint="Optional. An employee can only hold one account.">
                <Select
                  value={field.value}
                  onValueChange={(value) => field.onChange(value ?? NO_EMPLOYEE)}
                >
                  <SelectTrigger id="user-employee" className="w-full">
                    <SelectValue placeholder="No linked employee" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_EMPLOYEE}>No linked employee</SelectItem>
                    {employees.map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        {employee.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />

          {serverError ? <FormError message={serverError} /> : null}

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Creating…
                </>
              ) : (
                "Create user"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** PATCH /api/admin/users/:id — role and activation state. */
function EditUserDialog({ user, trigger }: { user: UserDto; trigger: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const defaults = (): EditValues => ({ role: user.role, status: user.status });

  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<EditValues>({
    resolver: zodResolver(editUserSchema),
    defaultValues: defaults(),
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      reset(defaults());
      setServerError(null);
    }
  }

  async function onSubmit(values: EditValues) {
    setServerError(null);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        // 403 = "you cannot change your own role" (and the API audits the
        // attempt); keep it on screen instead of swallowing it.
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setServerError(data?.message ?? "Unable to update this account.");
        return;
      }

      setOpen(false);
      toast.success("Account updated.");
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
          <DialogTitle>Edit {user.email}</DialogTitle>
          <DialogDescription>
            Role changes and deactivation are audited. You cannot change your own role.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Controller
            control={control}
            name="role"
            render={({ field, fieldState }) => (
              <Field label="Role" error={fieldState.error?.message}>
                <Select
                  value={field.value}
                  onValueChange={(value) => field.onChange(value ?? field.value)}
                >
                  <SelectTrigger id="edit-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />

          <Controller
            control={control}
            name="status"
            render={({ field, fieldState }) => (
              <Field
                label="Status"
                hint="Disabling an account signs out every session it holds."
                error={fieldState.error?.message}
              >
                <Select
                  value={field.value}
                  onValueChange={(value) => field.onChange(value ?? field.value)}
                >
                  <SelectTrigger id="edit-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                    <SelectItem value="DISABLED">DISABLED</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
          />

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
  );
}

/** POST /api/admin/users/:id/password — the reset always rotates the credential. */
function ResetPasswordDialog({ user, trigger }: { user: UserDto; trigger: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const defaults = (): ResetValues => ({ password: "" });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ResetValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: defaults(),
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      reset(defaults());
      setServerError(null);
    }
  }

  async function onSubmit(values: ResetValues) {
    setServerError(null);
    try {
      const response = await fetch(`/api/admin/users/${user.id}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: values.password }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setServerError(data?.message ?? "Unable to reset the password.");
        return;
      }

      setOpen(false);
      reset(defaults());
      toast.success(`Password reset — ${user.email} was signed out everywhere.`);
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
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for {user.email}. All sessions for this user will be signed
            out.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field
            label="New password"
            hint="Min 10 chars, letter + number."
            error={errors.password?.message}
          >
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.password)}
              {...register("password")}
            />
          </Field>

          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            All sessions for this user will be signed out.
          </div>

          {serverError ? <FormError message={serverError} /> : null}

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Resetting…
                </>
              ) : (
                "Reset password"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Header action: create (ADMIN only — the page guard computes that). */
export function NewUserButton({ employees }: { employees: EmployeeOption[] }) {
  return (
    <CreateUserDialog
      employees={employees}
      trigger={
        <>
          <Plus className="size-4" aria-hidden />
          New user
        </>
      }
    />
  );
}

/** Per-row edit + password reset. */
export function UserRowActions({ user }: { user: UserDto }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <EditUserDialog
        user={user}
        trigger={
          <>
            <Pencil className="size-4" aria-hidden />
            <span className="sr-only">Edit {user.email}</span>
          </>
        }
      />
      <ResetPasswordDialog
        user={user}
        trigger={
          <>
            <KeyRound className="size-4" aria-hidden />
            <span className="sr-only">Reset password for {user.email}</span>
          </>
        }
      />
    </div>
  );
}
