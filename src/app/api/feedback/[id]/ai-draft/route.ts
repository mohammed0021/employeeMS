import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guards";
import { feedbackActorFrom, generateAiDraft } from "@/lib/services/feedback";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/feedback/:id/ai-draft — generate (or regenerate) the AI draft.
 *
 * Gated on `update` (not `create`): drafting modifies an existing review, and
 * only ADMIN/HR hold either action. The 503/429 from `callAi` propagates
 * through apiHandler — an unconfigured provider fails loudly instead of
 * returning text that never came from a model.
 */
export const POST = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const session = await requirePermission("feedback", "update");
  const { id } = await params;
  return Response.json(await generateAiDraft(id, feedbackActorFrom(session)));
});
