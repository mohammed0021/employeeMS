import { z } from "zod";
import { PASSWORD_POLICY } from "@/lib/auth/password";
import { ROLES } from "@/lib/auth/permissions";

/**
 * Admin user-management validation (create/update/reset-password).
 *
 * Mirrors src/lib/validation/auth.ts on purpose: the password an admin sets
 * for someone must satisfy the SAME policy the user would have to satisfy
 * themselves, or "admin-set" becomes a backdoor for weak credentials.
 * Self-registration does not exist — these schemas are only ever parsed
 * behind requireRole("ADMIN").
 */

/** Same normalization as auth.ts: trim, validate, lowercase for the `@unique` check. */
const email = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email("Enter a valid email address.")
  .transform((value) => value.toLowerCase());

/**
 * Auth.ts's min/max messages, plus the letter+number rule: scrypt happily
 * stores any string, so the strength floor is a validation concern, not a
 * hashing one.
 */
const password = z
  .string()
  .min(
    PASSWORD_POLICY.minLength,
    `Password must be at least ${PASSWORD_POLICY.minLength} characters.`,
  )
  .max(PASSWORD_POLICY.maxLength)
  .regex(/[A-Za-z]/, "Password must include at least one letter.")
  .regex(/[0-9]/, "Password must include at least one number.");

/** Exact `UserStatus` enum values from prisma/schema.prisma. */
export const USER_STATUSES = ["ACTIVE", "DISABLED"] as const;

/** POST /api/admin/users — admin creates accounts; there is no self-signup. */
export const createUserSchema = z.object({
  email,
  role: z.enum(ROLES),
  password,
  employeeId: z.string().cuid().optional(),
});

/**
 * PATCH /api/admin/users/:id.
 *
 * `employeeId` accepts `null` (and the form-default `""`, normalized to
 * null) to unlink an employee profile without deleting the account —
 * `User.employeeId` is `SetNull` on employee deletion, so an unlinked user
 * is a state the schema already produces. `.optional()` stays last so an
 * omitted key remains `undefined` and leaves the stored value untouched.
 */
const employeeId = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().cuid().nullable().optional(),
);

/** At least one field must change — an empty PATCH is a client bug, not a no-op 200. */
export const updateUserSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    status: z.enum(USER_STATUSES).optional(),
    employeeId,
  })
  .refine(
    (value) => Object.values(value).some((v) => v !== undefined),
    { message: "Nothing to update." },
  );

/** POST /api/admin/users/:id/password — the admin reset always sets a NEW password. */
export const resetPasswordSchema = z.object({ password });

/** Shared blank→undefined preprocessing: `?role=` means "no filter", not an error. */
function blankToUndefined(value: unknown): unknown {
  return value === "" || value === null ? undefined : value;
}

/** List filters for GET /api/admin/users. */
export const adminUserFilterSchema = z.object({
  role: z.preprocess(blankToUndefined, z.enum(ROLES).optional()),
  status: z.preprocess(blankToUndefined, z.enum(USER_STATUSES).optional()),
});

/**
 * `YYYY-MM-DD` that is also a real calendar date — `2026-02-31` would
 * otherwise roll over to March silently (same guard as the leave service).
 */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  }, "Date is not a valid calendar date.");

/**
 * Filters for GET /api/audit. The audit table is append-only and read-only:
 * these fields only narrow what is READ, never what is written.
 */
export const auditLogFilterSchema = z.object({
  action: z.preprocess(blankToUndefined, z.string().trim().max(80).optional()),
  entityType: z.preprocess(blankToUndefined, z.string().trim().max(80).optional()),
  entityId: z.preprocess(blankToUndefined, z.string().trim().max(64).optional()),
  actorId: z.preprocess(blankToUndefined, z.string().trim().max(64).optional()),
  outcome: z.preprocess(blankToUndefined, z.enum(["SUCCESS", "FAILURE"]).optional()),
  dateFrom: z.preprocess(blankToUndefined, isoDate.optional()),
  dateTo: z.preprocess(blankToUndefined, isoDate.optional()),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type AdminUserFilters = z.infer<typeof adminUserFilterSchema>;
export type AuditLogFilters = z.infer<typeof auditLogFilterSchema>;
