import { apiHandler } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guards";
import { attritionActorFrom, runPredictions } from "@/lib/services/attrition";

/**
 * POST /api/attrition/run — score every ACTIVE employee (ADMIN/HR `create`).
 *
 * Answers 503 ATTRITION_MODEL_MISSING with an actionable message when no
 * trained models/attrition-model.json exists — honest absence instead of
 * fabricated risk scores.
 */
export const POST = apiHandler(async () => {
  const session = await requirePermission("attrition", "create");
  return Response.json(await runPredictions(attritionActorFrom(session)));
});
