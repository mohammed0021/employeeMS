/**
 * Chat service — RBAC, privacy scoping, persistence and the RAG prompt
 * assembly live here, not in the route handlers, so every entry point is
 * covered even if a caller forgets its `requirePermission()` check.
 *
 * PRIVACY HARD RULE: a conversation belongs to exactly one user. Every read
 * and write is scoped to `actor.id` — including for ADMIN. HR questions are
 * sensitive by nature ("what does the policy say about my disciplinary
 * record?"); no role, not even ADMIN, may list or open someone else's
 * conversations. Ownership failures return 403 BEFORE revealing whether the
 * id exists, so conversation ids cannot be probed either.
 */
import { prisma } from "@/lib/prisma";
import { errors } from "@/lib/errors";
import { can } from "@/lib/auth/permissions";
import { paginated, type ListQuery } from "@/lib/pagination";
import { retrieveContext } from "@/lib/ai/rag";
import { callAi, type AiMessage } from "@/lib/ai/provider";
import type { Actor } from "@/lib/services/actor";
import type { ChatListQuery } from "@/lib/validation/chat";
import type { Prisma } from "@/generated/prisma/client";
import type { ChatMessage, ChatConversation } from "@/generated/prisma/client";

type ChatAction = "create" | "read";

function assert(actor: Actor, action: ChatAction): void {
  if (!can(actor.role, "chat", action)) throw errors.forbidden();
}

// ─── DTOs ───────────────────────────────────────────────────────────────────

/** One policy citation attached to an assistant answer. */
export type MessageSourceDto = {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  section: string | null;
};

export type MessageDto = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  sources: MessageSourceDto[] | null;
  model: string | null;
  createdAt: string;
};

export type ConversationDto = {
  id: string;
  title: string;
  messageCount?: number;
  updatedAt: string;
  createdAt: string;
};

/**
 * Sources come back from Postgres as `Json`. Re-shape defensively instead of
 * casting: a malformed row degrades to `null` (no citations) rather than
 * pushing arbitrary JSON to the client.
 */
function toSourcesDto(value: Prisma.JsonValue | null): MessageSourceDto[] | null {
  if (!Array.isArray(value)) return null;
  const out: MessageSourceDto[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    if (
      typeof rec.documentId !== "string" ||
      typeof rec.documentTitle !== "string" ||
      typeof rec.chunkId !== "string"
    ) {
      continue;
    }
    out.push({
      documentId: rec.documentId,
      documentTitle: rec.documentTitle,
      chunkId: rec.chunkId,
      section: typeof rec.section === "string" ? rec.section : null,
    });
  }
  return out.length > 0 ? out : null;
}

/** Dates go out as ISO strings (JSON has no native Date). */
function toMessageDto(row: ChatMessage): MessageDto {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    sources: toSourcesDto(row.sources),
    model: row.model,
    createdAt: row.createdAt.toISOString(),
  };
}

function toConversationDto(row: ChatConversation & { _count?: { messages: number } }): ConversationDto {
  return {
    id: row.id,
    title: row.title,
    ...(row._count ? { messageCount: row._count.messages } : {}),
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * The caller's own conversations, newest activity first.
 *
 * Scoped to `actor.id` ALWAYS — the where-clause is not conditional on role.
 */
export async function listConversations(
  query: ChatListQuery | ListQuery,
  actor: Actor,
): Promise<{
  items: ConversationDto[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}> {
  assert(actor, "read");

  const where: Prisma.ChatConversationWhereInput = {
    userId: actor.id,
    ...(query.q
      ? { title: { contains: query.q, mode: "insensitive" as const } }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.chatConversation.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: { _count: { select: { messages: true } } },
    }),
    prisma.chatConversation.count({ where }),
  ]);

  return paginated(rows.map(toConversationDto), total, query);
}

/** Create a conversation for the caller. An empty title becomes the placeholder. */
export async function createConversation(
  actor: Actor,
  title?: string,
): Promise<ConversationDto> {
  assert(actor, "create");

  const row = await prisma.chatConversation.create({
    data: {
      userId: actor.id,
      title: title?.trim() || "New conversation",
    },
  });

  return toConversationDto(row);
}

/**
 * One conversation with its full transcript, in chronological order.
 *
 * A conversation that does not exist and one that belongs to someone else
 * both yield 403 — the caller learns nothing about which ids are real.
 */
export async function getConversation(
  id: string,
  actor: Actor,
): Promise<{ id: string; title: string; messages: MessageDto[] }> {
  assert(actor, "read");

  const row = await prisma.chatConversation.findUnique({
    where: { id },
    include: { messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });

  // Ownership before existence: never confirm a stranger's id.
  if (!row || row.userId !== actor.id) throw errors.forbidden();

  return { id: row.id, title: row.title, messages: row.messages.map(toMessageDto) };
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/** Delete the caller's own conversation (messages cascade). Ownership same as get. */
export async function deleteConversation(id: string, actor: Actor): Promise<void> {
  assert(actor, "read");

  const row = await prisma.chatConversation.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });

  if (!row || row.userId !== actor.id) throw errors.forbidden();

  await prisma.chatConversation.delete({ where: { id } });
}

/** Placeholder title we auto-replace from the first user message. */
const NEW_CONVERSATION_TITLE = "New conversation";

/** System prompt: the honesty contract. Answer only from excerpts; admit gaps; cite titles; stay short. */
const CHAT_SYSTEM_PROMPT =
  "You are an internal HR assistant for this company. Answer ONLY from the policy excerpts provided. " +
  "If the excerpts do not cover the question, say plainly that the company policies you have access to " +
  "do not cover it and suggest contacting HR — never invent policy. Cite the policy title when you use it. " +
  "Keep answers under 200 words.";

/** Fallback line injected when retrieval found nothing — even a weak model then has no excerpt to twist into policy. */
const NO_EXCERPTS_NOTE = "(No indexed policy excerpts matched this question.)";

/**
 * Send one user message and return the assistant reply.
 *
 * Flow:
 *  a. Load the conversation; ownership check (403 before existence).
 *  b. Persist the USER ChatMessage row — the question is kept even if the
 *     model call later fails, so the transcript never silently loses turns.
 *  c. Retrieve policy chunks for the question (RAG — src/lib/ai/rag.ts).
 *  d. Assemble AiMessage[]: the honesty system prompt; one user message of
 *     numbered excerpts, each prefixed 【policy: <title> | section: <section
 *     or general>】 (or the explicit no-excerpts note when retrieval found
 *     nothing); the last 6 prior messages of THIS conversation (most recent
 *     last, alternating user/assistant); then the current question as the
 *     final user message. Prior turns give the model context for follow-up
 *     questions; the 6-turn window bounds the prompt.
 *  e. callAi({purpose: "CHATBOT"}) — throws 503/429 via the provider; those
 *     propagate untouched. The user row from (b) remains.
 *  f. Persist the ASSISTANT row with the answer, the chunk citations as JSON
 *     (stored as NULL when there were no chunks — never an empty array), and
 *     the model name for observability.
 *  g. Still-titled "New conversation"? Rename from the first 60 chars of the
 *     user's message (guarded updateMany so a concurrent user rename wins).
 *  h. Return the assistant MessageDto.
 */
export async function sendChatMessage(
  conversationId: string,
  content: string,
  actor: Actor,
): Promise<MessageDto> {
  assert(actor, "create");

  // a. Load + ownership — 403 before existence, as everywhere in this service.
  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, userId: true, title: true },
  });
  if (!conversation || conversation.userId !== actor.id) throw errors.forbidden();

  // b. Persist the user turn first.
  const userMessage = await prisma.chatMessage.create({
    data: { conversationId, role: "USER", content },
  });
  // The list is ordered by conversation.updatedAt; move it with activity.
  await prisma.chatConversation.updateMany({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  // c. RAG retrieval. Empty result is fine — step (d) labels it explicitly.
  const chunks = await retrieveContext(content);

  // d. Prompt assembly.
  const excerpts =
    chunks.length > 0
      ? chunks
          .map(
            (chunk, index) =>
              `${index + 1}. 【policy: ${chunk.documentTitle} | section: ${chunk.section ?? "general"}】\n${chunk.content}`,
          )
          .join("\n\n")
      : NO_EXCERPTS_NOTE;

  // Prior turns excluding the row we just wrote, newest first, keep 6.
  const prior = await prisma.chatMessage.findMany({
    where: { conversationId, id: { not: userMessage.id } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 6,
  });

  const messages: AiMessage[] = [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
    { role: "user", content: `Policy excerpts:\n\n${excerpts}` },
    // Chronological, most recent last — chat models expect that order.
    ...prior
      .reverse()
      .map((m): AiMessage => ({ role: m.role === "USER" ? "user" : "assistant", content: m.content })),
    { role: "user", content },
  ];

  // e. Single model call; provider owns timeout/budget/errors.
  const result = await callAi({ actorId: actor.id, purpose: "CHATBOT", messages });

  // f. Persist the assistant turn with its citations. `undefined` leaves the
  // Json column NULL — the spec stores no-chunks as NULL, not [].
  const sources = chunks.map((chunk) => ({
    documentId: chunk.documentId,
    documentTitle: chunk.documentTitle,
    chunkId: chunk.chunkId,
    section: chunk.section,
  }));

  const assistantRow = await prisma.chatMessage.create({
    data: {
      conversationId,
      role: "ASSISTANT",
      content: result.text,
      sources: sources.length > 0 ? (sources as unknown as Prisma.InputJsonValue) : undefined,
      model: result.model,
    },
  });

  // g. Auto-title from the first message; the title guard means a rename the
  // user made mid-request is never clobbered.
  if (conversation.title === NEW_CONVERSATION_TITLE) {
    await prisma.chatConversation.updateMany({
      where: { id: conversationId, title: NEW_CONVERSATION_TITLE },
      data: { title: content.slice(0, 60) },
    });
  }

  // h.
  return toMessageDto(assistantRow);
}
