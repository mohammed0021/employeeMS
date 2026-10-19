import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guards";
import { approveFeedback, feedbackActorFrom } from "@/lib/services/feedback";
import { approveFeedbackSchema } from "@/lib/validation/feedback";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/feedback/:id/approve — finalize a review with human-written
 * final text (ADMIN/HR only; `approve` is the distinct matrix action). Once
 * finalized the row is immutable — see the service's state machine.
 */
export const POST = apiHandler(async (request: NextRequest, { params }: Params) => {
  const session = await requirePermission("feedback", "approve");
  const input = approveFeedbackSchema.parse(await request.json());
  const { id } = await params;
  return Response.json(await approveFeedback(id, input, feedbackActorFrom(session)));
});
