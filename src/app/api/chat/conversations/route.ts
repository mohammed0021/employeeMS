import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guards";
import { actorFrom } from "@/lib/services/actor";
import { createConversation, listConversations } from "@/lib/services/chat";
import { createConversationSchema, parseChatListQuery } from "@/lib/validation/chat";

/**
 * GET /api/chat/conversations — the caller's own conversations, newest
 * activity first. Every role (ADMIN included) sees ONLY their own rows;
 * that scoping is enforced in the service too.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const session = await requirePermission("chat", "read");
  const query = parseChatListQuery(request.nextUrl.searchParams);
  return Response.json(await listConversations(query, actorFrom(session)));
});

/** POST /api/chat/conversations — start a conversation (title optional). */
export const POST = apiHandler(async (request: NextRequest) => {
  const session = await requirePermission("chat", "create");
  const input = createConversationSchema.parse(await request.json());
  return Response.json(await createConversation(actorFrom(session), input.title), {
    status: 201,
  });
});
