import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission, requireUser } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { resolveSort } from "@/lib/pagination";
import { createFeedback, feedbackActorFrom, listFeedback } from "@/lib/services/feedback";
import {
  createFeedbackSchema,
  FEEDBACK_SORT_COLUMNS,
  parseFeedbackListQuery,
  toFeedbackSort,
} from "@/lib/validation/feedback";

/**
 * GET /api/feedback — ADMIN/HR see all rows (status/employeeId filters);
 * EMPLOYEE see only their own (readOwn, scoped in the service too).
 *
 * The probe mirrors the leave route: EMPLOYEE holds `readOwn`, not `read`, so
 * a plain requirePermission("feedback","read") would wrongly deny them their
 * own reviews.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const probe = await requireUser();
  const session = can(probe.user.role, "feedback", "read")
    ? await requirePermission("feedback", "read")
    : await requirePermission("feedback", "readOwn");
  const { query, filters } = parseFeedbackListQuery(request.nextUrl.searchParams);
  const sort = toFeedbackSort(
    resolveSort(request.nextUrl.searchParams, FEEDBACK_SORT_COLUMNS, "createdAt"),
  );
  return Response.json(await listFeedback(query, filters, sort, feedbackActorFrom(session)));
});

/** POST /api/feedback — create a DRAFT review (ADMIN/HR only). */
export const POST = apiHandler(async (request: NextRequest) => {
  const session = await requirePermission("feedback", "create");
  const input = createFeedbackSchema.parse(await request.json());
  return Response.json(await createFeedback(input, feedbackActorFrom(session)), {
    status: 201,
  });
});
