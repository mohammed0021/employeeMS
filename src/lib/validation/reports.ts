import { z } from "zod";

/**
 * Reports validation — an OPTIONAL date range plus an export kind.
 *
 * Both ends are optional: when absent the service defaults to the last 30
 * days, so `GET /api/reports/summary` with no params is always a useful
 * (and bounded) answer rather than a table scan since the beginning of
 * time.
 *
 * Dates are `YYYY-MM-DD` calendar strings (the columns they filter are
 * `@db.Date` or timestamps anchored at UTC midnight by the service) and are
 * checked as REAL calendar dates — `2026-02-31` would otherwise roll over
 * to March silently.
 */

function blankToUndefined(value: unknown): unknown {
  return value === "" || value === null ? undefined : value;
}

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

/** `?from=&to=` — blank means "default", and `from` must not pass `to`. */
export const reportRangeSchema = z
  .object({
    from: z.preprocess(blankToUndefined, isoDate.optional()),
    to: z.preprocess(blankToUndefined, isoDate.optional()),
  })
  .refine(
    (value) => !(value.from && value.to) || value.from <= value.to,
    {
      message: "The start date must be on or before the end date.",
      path: ["from"],
    },
  );

/** The four CSV reports an ADMIN/HR user can export. */
export const REPORT_EXPORT_KINDS = [
  "headcount",
  "attendance",
  "leave",
  "payroll",
] as const;

export const exportKindSchema = z.enum(REPORT_EXPORT_KINDS);

export type ReportRange = z.infer<typeof reportRangeSchema>;
export type ReportExportKind = z.infer<typeof exportKindSchema>;
