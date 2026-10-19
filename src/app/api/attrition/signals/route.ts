import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guards";
import { attritionActorFrom, listSignals } from "@/lib/services/attrition";
import { parseAttritionListQuery } from "@/lib/validation/attrition";

/**
 * GET /api/attrition/signals — latest risk predictions (ADMIN/HR `read`),
 * sorted riskScore desc in the service. Scores come from the last run; when
 * no run has happened yet the list is simply empty (the run endpoint is the
 * one that reports a missing model).
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const session = await requirePermission("attrition", "read");
  const { query, filters } = parseAttritionListQuery(request.nextUrl.searchParams);
  return Response.json(await listSignals(query, filters, attritionActorFrom(session)));
});
