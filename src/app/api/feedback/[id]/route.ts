import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission, requireUser } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { feedbackActorFrom, getFeedback, updateFeedback } from "@/lib/services/feedback";
import { updateFeedbackSchema } from "@/lib/validation/feedback";

type Params = { params: Promise<{ id: string }> };

/** GET /api/feedback/:id — ADMIN/HR any; EMPLOYEE only their own (else 403). */
export const GET = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const probe = await requireUser();
  const session = can(probe.user.role, "feedback", "read")
    ? await requirePermission("feedback", "read")
    : await requirePermission("feedback", "readOwn");
  const { id } = await params;
  return Response.json(await getFeedback(id, feedbackActorFrom(session)));
});

/**
 * PATCH /api/feedback/:id — edit indicators and/or final text (ADMIN/HR).
 * FINALIZED rows are rejected by the service with 409.
 */
export const PATCH = apiHandler(async (request: NextRequest, { params }: Params) => {
  const session = await requirePermission("feedback", "update");
  const input = updateFeedbackSchema.parse(await request.json());
  const { id } = await params;
  return Response.json(await updateFeedback(id, input, feedbackActorFrom(session)));
});
