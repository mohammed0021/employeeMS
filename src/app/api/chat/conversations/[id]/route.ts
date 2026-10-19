import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guards";
import { actorFrom } from "@/lib/services/actor";
import { deleteConversation, getConversation } from "@/lib/services/chat";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/chat/conversations/:id — full transcript of the caller's own
 * conversation. Someone else's id (or a nonexistent one) is a 403, never a
 * 404: existence itself is not disclosed.
 */
export const GET = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const session = await requirePermission("chat", "read");
  const { id } = await params;
  return Response.json(await getConversation(id, actorFrom(session)));
});

/** DELETE /api/chat/conversations/:id — owner-only; messages cascade. */
export const DELETE = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const session = await requirePermission("chat", "read");
  const { id } = await params;
  await deleteConversation(id, actorFrom(session));
  return new Response(null, { status: 204 });
});
