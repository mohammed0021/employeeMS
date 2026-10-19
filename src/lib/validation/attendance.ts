import { z } from "zod";

/**
 * Sort allow-list for the attendance list endpoint. `resolveSort` only ever
 * returns a member of this set — a raw query param never reaches `orderBy`.
 */
export const ATTENDANCE_SORT_FIELDS = [
  "date",
  "checkIn",
  "checkOut",
  "status",
  "createdAt",
] as const;

/** `HH:MM` or `HH:MM:SS` (24h). Exported so the service parses consistently. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** Plain calendar date (`@db.Date` column) — no time, no zone ambiguity. */
const calendarDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format.")
  // Rejects impossible dates such as 2025-02-30 (ISO parsing returns NaN).
  .refine(
    (value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)),
    "Date is not a real calendar date.",
  );

/**
 * Check-in/out: a time of day (`HH:MM`, anchored to the record's date by the
 * service) or a full ISO datetime — the DTO round-trips ISO strings, forms
 * tend to send HH:MM; accept both.
 */
const checkTime = z
  .string()
  .trim()
  .refine(
    (value) => TIME_PATTERN.test(value) || !Number.isNaN(Date.parse(value)),
    "Time must be HH:MM or a valid ISO datetime.",
  );

const employeeId = z.string().trim().min(1, "Employee is required.");

const status = z.enum(["PRESENT", "ABSENT", "HALF_DAY", "REMOTE"]);

const note = z.string().trim().max(500, "Note must be 500 characters or fewer.");

/** POST /api/attendance — record a day's attendance for one employee. */
export const recordAttendanceSchema = z.object({
  employeeId,
  date: calendarDate,
  status,
  checkIn: checkTime.optional(),
  checkOut: checkTime.optional(),
  note: note.optional(),
});

/**
 * PATCH /api/attendance/:id — correct an existing record. All fields
 * optional; times/note nullable so a correction can clear a mistaken value.
 */
export const correctAttendanceSchema = z
  .object({
    employeeId: employeeId.optional(),
    date: calendarDate.optional(),
    status: status.optional(),
    checkIn: checkTime.nullable().optional(),
    checkOut: checkTime.nullable().optional(),
    note: note.nullable().optional(),
  })
  .refine(
    (value) => Object.values(value).some((v) => v !== undefined),
    { message: "Nothing to update.", path: ["employeeId"] },
  );

/**
 * List filters beyond the shared page/limit/q handled by `parseListQuery`.
 * `dateFrom`/`dateTo` are inclusive bounds on the calendar `date` column.
 */
export const attendanceListFiltersSchema = z.object({
  dateFrom: calendarDate.optional(),
  dateTo: calendarDate.optional(),
  employeeId: employeeId.optional(),
  status: status.optional(),
});

export type RecordAttendanceInput = z.infer<typeof recordAttendanceSchema>;
export type CorrectAttendanceInput = z.infer<typeof correctAttendanceSchema>;
export type AttendanceListFilters = z.infer<typeof attendanceListFiltersSchema>;
