"use client";

/**
 * Change own password.
 *
 * POST /api/auth/change-password; on success the API revokes EVERY session of
 * this user (including this one) and clears the session cookie, so the form
 * only reports what happened and empties itself — the next navigation asks
 * for a fresh sign-in. Failures (wrong current password, too-weak new
 * password) come back as `{code, message}` and are surfaced verbatim.
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ApiErrorBody = { code?: string; message?: string };

/**
 * Mirrors src/lib/validation/auth.ts (changePasswordSchema) plus the strength
 * floor: min 10, letter + number, and a confirm field checked client-side.
 */
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required.").max(128),
    newPassword: z
      .string()
      .min(10, "Password must be at least 10 characters.")
      .max(128, "Password must be 128 characters or fewer.")
      .regex(/[A-Za-z]/, "Password must include at least one letter.")
      .regex(/[0-9]/, "Password must include at least one number."),
    confirm: z.string().min(1, "Confirm your new password."),
  })
  .refine((values) => values.newPassword === values.confirm, {
    message: "Passwords do not match.",
    path: ["confirm"],
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    message: "New password must differ from the current one.",
    path: ["newPassword"],
  });

type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

function defaults(): ChangePasswordValues {
  return { currentPassword: "", newPassword: "", confirm: "" };
}

export function ChangePasswordForm() {
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: defaults(),
  });

  async function onSubmit(values: ChangePasswordValues) {
    setServerError(null);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `confirm` never leaves the client — the API schema doesn't take it.
        body: JSON.stringify({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setServerError(data?.message ?? "Unable to change your password.");
        return;
      }

      reset(defaults());
      toast.success("Password changed — all other sessions were signed out.");
    } catch {
      setServerError("Network error. Please try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="current-password">Current password</Label>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          aria-invalid={Boolean(errors.currentPassword)}
          {...register("currentPassword")}
        />
        {errors.currentPassword ? (
          <p className="text-sm text-destructive">{errors.currentPassword.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          aria-invalid={Boolean(errors.newPassword)}
          {...register("newPassword")}
        />
        <p className="text-xs text-muted-foreground">
          Min 10 chars, letter + number.
        </p>
        {errors.newPassword ? (
          <p className="text-sm text-destructive">{errors.newPassword.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          aria-invalid={Boolean(errors.confirm)}
          {...register("confirm")}
        />
        {errors.confirm ? (
          <p className="text-sm text-destructive">{errors.confirm.message}</p>
        ) : null}
      </div>

      {serverError ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {serverError}
        </div>
      ) : null}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Changing…
          </>
        ) : (
          "Change password"
        )}
      </Button>
    </form>
  );
}
