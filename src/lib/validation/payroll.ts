import { z } from "zod";

/**
 * Payroll input validation — exact decimal TEXT in, never a float.
 *
 * Money fields are normalized before the pattern check: JSON numbers are
 * stringified (`5000` → `"5000"`), strings are trimmed, and the pattern then
 * requires plain digits with at most 2 fractional digits — matching the
 * `@db.Decimal(12, 2)` columns. A JS `number` therefore never reaches the
 * service as arithmetic input; all sign/sum rules (base > 0, bonus/deduction
 * >= 0, net >= 0) are enforced there with Prisma's `Decimal`.
 */
const AMOUNT_PATTERN = /^-?\d{1,10}(\.\d{1,2})?$/;
const AMOUNT_MESSAGE = "Must be an amount of at most 9,999,999,999.99 with up to 2 decimal places.";

/** `string | number` in → exact decimal string out (sign rules live in the service). */
const amount = () =>
  z.preprocess(
    (value) =>
      typeof value === "number"
        ? String(value)
        : typeof value === "string"
          ? value.trim()
          : value,
    z.string().regex(AMOUNT_PATTERN, AMOUNT_MESSAGE),
  );

/** POST /api/payroll — generate one payroll record for an employee/period. */
export const createPayrollSchema = z.object({
  employeeId: z.string().trim().min(1, "Employee is required.").max(64),
  month: z
    .coerce.number()
    .int("Month must be an integer.")
    .min(1, "Month must be between 1 and 12.")
    .max(12, "Month must be between 1 and 12."),
  year: z
    .coerce.number()
    .int("Year must be an integer.")
    .min(2000, "Year must be between 2000 and 2100.")
    .max(2100, "Year must be between 2000 and 2100."),
  baseSalary: amount(),
  bonus: amount().optional(),
  deduction: amount().optional(),
});

/** GET /api/payroll and GET /api/payroll/export — shared row filters. */
export const payrollFilterSchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  employeeId: z.string().trim().min(1).max(64).optional(),
  status: z.enum(["DRAFT", "FINAL"]).optional(),
});

/** Parse `request.nextUrl.searchParams` into typed payroll filters. */
export function parsePayrollFilters(params: URLSearchParams): PayrollFilters {
  return payrollFilterSchema.parse({
    month: params.get("month") ?? undefined,
    year: params.get("year") ?? undefined,
    employeeId: params.get("employeeId") ?? undefined,
    status: params.get("status") ?? undefined,
  });
}

// ─── PATCH intents ───────────────────────────────────────────────────────────

/** `{ update: { … } }` — at least one field must change. */
const updateIntentBody = z
  .object({
    baseSalary: amount().optional(),
    bonus: amount().optional(),
    deduction: amount().optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "Nothing to update.",
  });

/**
 * The two PATCH intents as a Zod discriminated union on `intent`.
 *
 * The wire shapes use different keys (`{ update: … }` vs `{ finalize: true }`),
 * and Zod can only discriminate on a key present — with a literal value — in
 * every option. `toIntent` below normalizes the wire shape into that explicit
 * discriminator, so parse failures still surface as precise 400 field errors
 * and the service switches on a single narrowed union.
 */
const modifyIntentSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("update"), update: updateIntentBody }),
  z.object({ intent: z.literal("finalize"), finalize: z.literal(true) }),
]);

function toIntent(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const body = value as Record<string, unknown>;
  if ("update" in body) return { intent: "update", update: body.update };
  if ("finalize" in body) return { intent: "finalize", finalize: body.finalize };
  return value;
}

export const modifyPayrollSchema = z.preprocess(toIntent, modifyIntentSchema);

// ─── Types ───────────────────────────────────────────────────────────────────

export type CreatePayrollInput = z.infer<typeof createPayrollSchema>;
export type PayrollFilters = z.infer<typeof payrollFilterSchema>;
export type ModifyPayrollInput = z.infer<typeof modifyPayrollSchema>;
