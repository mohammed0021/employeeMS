import { z } from "zod";

/**
 * Employee input validation — mirrors src/lib/validation/departments.ts.
 *
 * Two deliberate choices:
 *  - `salary` is coerced to (and checked as) a number but stored as an exact
 *    decimal string, so a JSON IEEE-754 float can never round money.
 *  - `joinDate` is parsed as a UTC calendar date: the DTO slices the ISO
 *    string to YYYY-MM-DD, and a local-time parse in a non-UTC zone would
 *    shift the rendered day.
 */

export const EMPLOYEE_STATUSES = ["ACTIVE", "INACTIVE", "ON_LEAVE"] as const;

/** numeric(12, 2) upper bound. */
const MAX_SALARY = 9_999_999_999.99;

const employeeCode = z
  .string()
  .trim()
  .min(2, "Employee code must be at least 2 characters.")
  .max(40, "Employee code must be 40 characters or fewer.");

const name = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(80, `${label} must be 80 characters or fewer.`);

/** Same treatment as auth.ts: trim, validate, normalize for the `@unique` check. */
const email = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email("Enter a valid email address.")
  .transform((value) => value.toLowerCase());

/**
 * Accepts `"…"`, `null` (clear) and `""` (form default) — all but a real
 * number become NULL. `.optional()` stays last so a PATCH that omits the
 * field keeps it `undefined` and leaves the stored value untouched.
 */
const phone = z
  .string()
  .trim()
  .max(40, "Phone must be 40 characters or fewer.")
  .nullable()
  .transform((value) => (value && value.length > 0 ? value : null))
  .optional();

const position = z
  .string()
  .trim()
  .min(1, "Position is required.")
  .max(120, "Position must be 120 characters or fewer.");

const departmentId = z
  .string()
  .trim()
  .min(1, "Department is required.")
  .max(60, "Department id looks invalid.");

function parseJoinDate(value: string): Date {
  // Date-only strings are UTC by spec; anything else keeps its own offset.
  return value.length === 10 ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
}

const joinDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, "Join date must be an ISO date, e.g. 2024-05-01.")
  .refine(
    (value) => !Number.isNaN(parseJoinDate(value).getTime()),
    "Join date is not a valid calendar date.",
  )
  .transform(parseJoinDate);

const salary = z
  .union([z.number(), z.string().trim().min(1, "Salary is required.")])
  .transform((value) => (typeof value === "string" ? Number(value) : value))
  // NaN/-Infinity/+Infinity all fail these bounds — no separate finite() needed.
  .refine(
    (amount) => amount >= 0 && amount <= MAX_SALARY,
    "Salary must be a number between 0 and 9,999,999,999.99.",
  );

const status = z.enum(EMPLOYEE_STATUSES);

export const createEmployeeSchema = z.object({
  employeeCode,
  firstName: name("First name"),
  lastName: name("Last name"),
  email,
  phone,
  position,
  joinDate,
  salary,
  departmentId,
  status: status.optional(),
});

/** At least one field must change — an empty PATCH is a client bug, not a no-op 200. */
export const updateEmployeeSchema = z
  .object({
    employeeCode: employeeCode.optional(),
    firstName: name("First name").optional(),
    lastName: name("Last name").optional(),
    email: email.optional(),
    phone,
    position: position.optional(),
    joinDate: joinDate.optional(),
    salary: salary.optional(),
    departmentId: departmentId.optional(),
    status: status.optional(),
  })
  .refine(
    (value) => Object.values(value).some((v) => v !== undefined),
    { message: "Nothing to update.", path: ["employeeCode"] },
  );

/**
 * Shared filter shape for the list and the CSV export. `?departmentId=` /
 * `?status=` (empty or null) mean "no filter", not a validation error;
 * genuinely invalid values (e.g. `status=BOGUS`) still fail loudly.
 */
export const employeeFilterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  departmentId: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    departmentId.optional(),
  ),
  status: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    status.optional(),
  ),
});

/**
 * Sort allow-list for the list endpoint — `resolveSort` checks against this
 * so a raw query param can never reach Prisma's orderBy.
 */
export const EMPLOYEE_SORT_FIELDS: ReadonlySet<string> = new Set([
  "lastName",
  "firstName",
  "joinDate",
  "employeeCode",
  "salary",
  "createdAt",
]);

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type EmployeeFilters = z.infer<typeof employeeFilterSchema>;
