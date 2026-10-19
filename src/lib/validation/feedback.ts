import { z } from "zod";
import { parseListQuery, type ListQuery } from "@/lib/pagination";

/**
 * Performance-feedback validation.
 *
 * The five ratings ARE the review data, so every one of them is a required
 * whole number in 1..5 — a missing or fractional rating is rejected with a
 * field-level message instead of being coerced into something that looks like
 * data. State-machine rules (DRAFT → AI_DRAFT → FINALIZED) are business rules
 * and live in the feedback service, not here.
 */

export const FEEDBACK_STATUSES = ["DRAFT", "AI_DRAFT", "FINALIZED"] as const;

/** One 1..5 rating with a message naming the dimension that failed. */
const rating = (label: string) =>
  z
    .number({ message: `${label} rating is required.` })
    .int(`${label} rating must be a whole number.`)
    .min(1, `${label} rating must be at least 1.`)
    .max(5, `${label} rating must be 5 or fewer.`);

/** The structured indicators a reviewer supplies — the input to the AI draft. */
export const feedbackIndicatorsSchema = z.object({
  communication: rating("Communication"),
  qualityOfWork: rating("Quality of work"),
  productivity: rating("Productivity"),
  teamwork: rating("Teamwork"),
  reliability: rating("Reliability"),
  strengths: z
    .string()
    .trim()
    .max(500, "Strengths must be 500 characters or fewer.")
    .optional(),
  improvementAreas: z
    .string()
    .trim()
    .max(500, "Improvement areas must be 500 characters or fewer.")
    .optional(),
});

export type FeedbackIndicators = z.infer<typeof feedbackIndicatorsSchema>;

/** POST /api/feedback — the reviewer names the employee; status starts DRAFT. */
export const createFeedbackSchema = z.object({
  employeeId: z.string().cuid("Employee id looks invalid."),
  cycleLabel: z
    .string()
    .trim()
    .min(2, "Cycle label must be at least 2 characters.")
    .max(80, "Cycle label must be 80 characters or fewer."),
  indicators: feedbackIndicatorsSchema,
});

export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;

/** PATCH /api/feedback/:id — at least one field must change. */
export const updateFeedbackSchema = z
  .object({
    finalText: z
      .string()
      .trim()
      .min(1, "Final text must be at least 1 character.")
      .max(4000, "Final text must be 4000 characters or fewer.")
      .optional(),
    indicators: feedbackIndicatorsSchema.optional(),
  })
  .refine((value) => value.finalText !== undefined || value.indicators !== undefined, {
    message: "Nothing to update.",
    path: ["finalText"],
  });

export type UpdateFeedbackInput = z.infer<typeof updateFeedbackSchema>;

/**
 * POST /api/feedback/:id/approve — finalizing always requires a human-written
 * final text; an AI draft alone can never become the official review.
 */
export const approveFeedbackSchema = z.object({
  finalText: z
    .string()
    .trim()
    .min(1, "Final text is required to finalize feedback.")
    .max(4000, "Final text must be 4000 characters or fewer."),
});

export type ApproveFeedbackInput = z.infer<typeof approveFeedbackSchema>;

// ─── List query ─────────────────────────────────────────────────────────────

/**
 * Shared list filters. They only ever apply to org-wide readers: the service
 * drops them for EMPLOYEE callers, because `readOwn` scoping must not be
 * rewritable from the query string.
 */
export const feedbackListFilters = z.object({
  status: z.enum(FEEDBACK_STATUSES).optional(),
  employeeId: z.string().trim().min(1).max(64).optional(),
});

export type FeedbackFilters = z.infer<typeof feedbackListFilters>;

/** Allow-list consumed by `resolveSort` — raw query params never reach orderBy. */
export const FEEDBACK_SORT_COLUMNS: ReadonlySet<string> = new Set([
  "createdAt",
  "updatedAt",
  "cycleLabel",
  "status",
]);

export type FeedbackSortField = "createdAt" | "updatedAt" | "cycleLabel" | "status";

export type FeedbackSort = { field: FeedbackSortField; dir: "asc" | "desc" };

/** `resolveSort` guarantees membership in the allow-list; this narrows for TS. */
export function toFeedbackSort(sort: {
  field: string;
  dir: "asc" | "desc";
}): FeedbackSort {
  return {
    field: (FEEDBACK_SORT_COLUMNS.has(sort.field)
      ? sort.field
      : "createdAt") as FeedbackSortField,
    dir: sort.dir,
  };
}

/**
 * Parse `request.nextUrl.searchParams` into the bounded list query plus the
 * module filters. Sorting is resolved separately by the route via
 * `resolveSort(params, FEEDBACK_SORT_COLUMNS, …)` + `toFeedbackSort`.
 */
export function parseFeedbackListQuery(params: URLSearchParams): {
  query: ListQuery;
  filters: FeedbackFilters;
} {
  return {
    query: parseListQuery(params),
    filters: feedbackListFilters.parse({
      status: params.get("status") ?? undefined,
      employeeId: params.get("employeeId") ?? undefined,
    }),
  };
}
