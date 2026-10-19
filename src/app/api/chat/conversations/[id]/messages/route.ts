import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guards";
import { actorFrom } from "@/lib/services/actor";
import { sendChatMessage } from "@/lib/services/chat";
import { sendMessageSchema } from "@/lib/validation/chat";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/chat/conversations/:id/messages — one user turn in the caller's
 * own conversation; responds 201 with the assistant reply (RAG over READY
 * policy documents). Ownership, retrieval and the model call live in the
 * service; provider failures surface as the provider's 503/429.
 */
export const POST = apiHandler(async (request: NextRequest, { params }: Params) => {
  const session = await requirePermission("chat", "create");
  const { id } = await params;
  const input = sendMessageSchema.parse(await request.json());
  return Response.json(await sendChatMessage(id, input.content, actorFrom(session)), {
    status: 201,
  });
});
