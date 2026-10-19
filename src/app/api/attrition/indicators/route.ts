import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guards";
import {
  attritionActorFrom,
  listIndicators,
  upsertIndicator,
} from "@/lib/services/attrition";
import {
  indicatorUpsertSchema,
  parseAttritionListQuery,
} from "@/lib/validation/attrition";

/**
 * GET /api/attrition/indicators — the model's input rows (ADMIN/HR `read`;
 * EMPLOYEE holds no `attrition` action at all, so requirePermission denies
 * them outright — see the matrix in src/lib/auth/permissions.ts).
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const session = await requirePermission("attrition", "read");
  const { query, filters } = parseAttritionListQuery(request.nextUrl.searchParams);
  return Response.json(await listIndicators(query, filters, attritionActorFrom(session)));
});

/** PUT /api/attrition/indicators — create/replace one employee's row. */
export const PUT = apiHandler(async (request: NextRequest) => {
  const session = await requirePermission("attrition", "update");
  const input = indicatorUpsertSchema.parse(await request.json());
  return Response.json(await upsertIndicator(input, attritionActorFrom(session)));
});
