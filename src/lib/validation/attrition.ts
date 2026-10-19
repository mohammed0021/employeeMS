import { z } from "zod";
import { parseListQuery, type ListQuery } from "@/lib/pagination";

/**
 * Attrition validation.
 *
 * Bounds mirror the model's feature dictionary (models/README.md) exactly:
 * satisfaction scales 1..5, counts 0..50 — the same ranges the training data
 * was constrained to, so a bad API input cannot drift outside the space the
 * coefficients were fitted in. Business rules (who may run predictions) live
 * in the attrition service.
 */

export const RISK_CATEGORIES = ["LOW", "MEDIUM", "HIGH"] as const;

const scale5 = (label: string) =>
  z
    .number({ message: `${label} is required.` })
    .int(`${label} must be a whole number.`)
    .min(1, `${label} must be at least 1.`)
    .max(5, `${label} must be 5 or fewer.`);

const count = (label: string) =>
  z
    .number({ message: `${label} is required.` })
    .int(`${label} must be a whole number.`)
    .min(0, `${label} must not be negative.`)
    .max(50, `${label} must be 50 or fewer.`);

/** PUT /api/attrition/indicators — one row per employee (employeeId unique). */
export const indicatorUpsertSchema = z.object({
  employeeId: z.string().cuid("Employee id looks invalid."),
  overtime: z.boolean({ message: "Overtime must be true or false." }),
  jobSatisfaction: scale5("Job satisfaction"),
  workLifeBalance: scale5("Work-life balance"),
  environmentSatisfaction: scale5("Environment satisfaction"),
  trainingTimesLastYear: count("Training times last year"),
  yearsSinceLastPromotion: count("Years since last promotion"),
});

export type IndicatorUpsertInput = z.infer<typeof indicatorUpsertSchema>;

/**
 * Shared list filters for the indicators and signals endpoints.
 *
 * `category` only exists on signals; the indicators list ignores it (documented
 * there) rather than needing a second schema that differs by one field.
 */
export const attritionListFilters = z.object({
  category: z.enum(RISK_CATEGORIES).optional(),
  departmentId: z.string().trim().min(1).max(64).optional(),
});

export type AttritionFilters = z.infer<typeof attritionListFilters>;

/** Parse `request.nextUrl.searchParams` into the bounded list query + filters. */
export function parseAttritionListQuery(params: URLSearchParams): {
  query: ListQuery;
  filters: AttritionFilters;
} {
  return {
    query: parseListQuery(params),
    filters: attritionListFilters.parse({
      category: params.get("category") ?? undefined,
      departmentId: params.get("departmentId") ?? undefined,
    }),
  };
}
