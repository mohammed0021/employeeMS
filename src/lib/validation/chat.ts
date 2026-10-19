import { z } from "zod";
import { listQuerySchema, parseListQuery } from "@/lib/pagination";

/**
 * Chat validation.
 *
 * Ownership, per-user scoping and the RAG flow are business rules and live
 * in the chat service, not here. The list query is the shared pagination
 * schema — conversations are always scoped to the caller, so `q` only ever
 * filters the caller's own titles.
 */

/** POST /api/chat/conversations — optional title; defaults to "New conversation". */
export const createConversationSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title cannot be empty.")
    .max(120, "Title must be 120 characters or fewer.")
    .optional(),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;

/** POST /api/chat/conversations/:id/messages — one user turn. */
export const sendMessageSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Message cannot be empty.")
    .max(2000, "Message must be 2000 characters or fewer."),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/** GET /api/chat/conversations — the shared page/limit/q shape is enough. */
export type ChatListQuery = z.infer<typeof listQuerySchema>;

export const chatListQuerySchema = listQuerySchema;

/** Parse `request.nextUrl.searchParams` into the chat list query. */
export function parseChatListQuery(params: URLSearchParams): ChatListQuery {
  return parseListQuery(params);
}
