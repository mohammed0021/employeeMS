import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission, requireUser } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import {
  cancelLeaveRequest,
  decideLeaveRequest,
  getLeaveRequest,
  leaveActorFrom,
} from "@/lib/services/leave";
import { leaveActionSchema } from "@/lib/validation/leave";

type Params = { params: Promise<{ id: string }> };

/** GET /api/leave/:id — ADMIN/HR any; EMPLOYEE only their own (else 403). */
export const GET = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const probe = await requireUser();
  const session = can(probe.user.role, "leave", "read")
    ? await requirePermission("leave", "read")
    : await requirePermission("leave", "readOwn");
  const { id } = await params;
  return Response.json(await getLeaveRequest(id, leaveActorFrom(session)));
});

/**
 * PATCH /api/leave/:id — two intents:
 *  - { decision: "APPROVED" | "REJECTED", decisionReason? } → "approve"
 *    (ADMIN/HR; never your own request — hard rule 3; must be PENDING);
 *  - { action: "CANCEL" } → "update" + owner only; must be PENDING.
 */
export const PATCH = apiHandler(async (request: NextRequest, { params }: Params) => {
  const input = leaveActionSchema.parse(await request.json());
  const session =
    input.intent === "decision"
      ? await requirePermission("leave", "approve")
      : await requirePermission("leave", "update");
  const actor = leaveActorFrom(session);
  const { id } = await params;

  if (input.intent === "decision") {
    return Response.json(
      await decideLeaveRequest(actor, id, {
        decision: input.decision,
        decisionReason: input.decisionReason,
      }),
    );
  }
  return Response.json(await cancelLeaveRequest(actor, id));
});
