import { z } from "zod";
import { listQuerySchema, parseListQuery } from "@/lib/pagination";

/**
 * Leave validation.
 *
 * Dates arrive as `YYYY-MM-DD` strings (the columns are `@db.Date`); the
 * service anchors them at UTC midnight. Ordering and state-machine rules are
 * business rules and live in the leave service, not here.
 */

const LEAVE_TYPES = ["ANNUAL", "SICK", "UNPAID", "MATERNITY", "PATERNITY", "OTHER"] as const;
const LEAVE_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format.");

/** POST /api/leave — submit. The employeeId is NEVER part of the body. */
export const submitLeaveSchema = z.object({
  startDate: isoDate,
  endDate: isoDate,
  type: z.enum(LEAVE_TYPES),
  reason: z
    .string()
    .trim()
    .min(5, "Reason must be at least 5 characters.")
    .max(500, "Reason must be 500 characters or fewer."),
});

export type SubmitLeaveInput = z.infer<typeof submitLeaveSchema>;

// ─── PATCH intents ──────────────────────────────────────────────────────────

const decisionIntent = z
  .object({
    intent: z.literal("decision"),
    decision: z.enum(["APPROVED", "REJECTED"]),
    decisionReason: z
      .string()
      .trim()
      .max(500, "Decision reason must be 500 characters or fewer.")
      .optional(),
  })
  .superRefine((value, ctx) => {
    // A rejection the employee can't act on is not a decision, it's a door
    // closing in their face: the reason is the only feedback they get, and
    // it is what the audit trail and any later dispute rest on. Approvals
    // stay reason-optional — nothing is being withheld there.
    if (value.decision === "REJECTED" && !value.decisionReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decisionReason"],
        message: "A reason is required when rejecting a leave request.",
      });
    }
  });

const cancelIntent = z.object({
  intent: z.literal("cancel"),
  action: z.literal("CANCEL"),
});

/**
 * PATCH /api/leave/:id accepts two mutually exclusive intents whose bodies
 * use different keys (`decision` vs `action`). Since no single discriminator
 * key spans both shapes, the raw body is tagged with a synthetic `intent` and
 * then parsed through a real Zod discriminated union — TypeScript narrows
 * cleanly on `input.intent` afterwards.
 */
export const leaveActionSchema = z.preprocess(
  (body) => {
    if (body === null || typeof body !== "object" || Array.isArray(body)) return body;
    const record = body as Record<string, unknown>;
    if ("decision" in record) return { ...record, intent: "decision" as const };
    if ("action" in record) return { ...record, intent: "cancel" as const };
    return body;
  },
  z.discriminatedUnion("intent", [decisionIntent, cancelIntent]),
);

export type LeaveActionInput = z.infer<typeof leaveActionSchema>;

// ─── List query ─────────────────────────────────────────────────────────────

const LEAVE_SORT_FIELDS = ["startDate", "endDate", "status", "submittedAt"] as const;

/** Allow-list consumed by `resolveSort` — raw query params never reach orderBy. */
export const LEAVE_SORT_COLUMNS: ReadonlySet<string> = new Set(LEAVE_SORT_FIELDS);

export type LeaveSortField = (typeof LEAVE_SORT_FIELDS)[number];
export type LeaveSort = { field: LeaveSortField; dir: "asc" | "desc" };

/** `resolveSort` guarantees membership in the allow-list; this narrows for TS. */
export function toLeaveSort(sort: { field: string; dir: "asc" | "desc" }): LeaveSort {
  return {
    field: (LEAVE_SORT_FIELDS as readonly string[]).includes(sort.field)
      ? (sort.field as LeaveSortField)
      : "submittedAt",
    dir: sort.dir,
  };
}

export const leaveListQuerySchema = listQuerySchema.extend({
  status: z.enum(LEAVE_STATUSES).optional(),
  type: z.enum(LEAVE_TYPES).optional(),
  employeeId: z.string().trim().min(1).max(64).optional(),
});

export type LeaveListQuery = z.infer<typeof leaveListQuerySchema>;

/** Parse `request.nextUrl.searchParams` into the leave list query. */
export function parseLeaveListQuery(params: URLSearchParams): LeaveListQuery {
  return leaveListQuerySchema.parse({
    ...parseListQuery(params),
    status: params.get("status") ?? undefined,
    type: params.get("type") ?? undefined,
    employeeId: params.get("employeeId") ?? undefined,
  });
}
