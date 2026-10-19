/**
 * The single door to LLM calls.
 *
 * Everything the app asks a model — chatbot turns, feedback drafts — goes
 * through `callAi`. One choke point means one place for the rules that must
 * never be duplicated: timeouts, single-attempt (never retry-storm free
 * quota), the per-user daily budget, and the AiUsageLog write that records
 * *metadata only* (never prompt or completion text).
 *
 * Three modes, decided by env:
 *  - Real:    OPENROUTER_API_KEY set            → live OpenRouter call.
 *  - Mock:    AI_MOCK=1                          → deterministic stub, clearly
 *             labelled (provider "mock") so a screenshot can never be mistaken
 *             for a real model answer. For FEEDBACK it templates from the
 *             reviewer's own indicators — reviewer-authored content, not model
 *             output — and the UI must show the MOCK badge either way.
 *  - Unavailable: neither                        → throws 503 AI_UNAVAILABLE.
 *             A missing key is an honest failure, never an invented answer.
 */
import { prisma } from "@/lib/prisma";
import { errors } from "@/lib/errors";
import type { AiPurpose } from "@/generated/prisma/enums";

const env = {
  provider: process.env.AI_PROVIDER ?? "openrouter",
  model: process.env.AI_MODEL ?? "",
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
  baseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  maxInputTokens: int(process.env.AI_MAX_INPUT_TOKENS, 6000),
  maxOutputTokens: int(process.env.AI_MAX_OUTPUT_TOKENS, 700),
  timeoutMs: int(process.env.AI_TIMEOUT_MS, 25_000),
  dailyUserLimit: int(process.env.AI_DAILY_USER_LIMIT, 40),
  mock: process.env.AI_MOCK === "1",
};

function int(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type AiMessage = { role: "system" | "user" | "assistant"; content: string };

export type AiResult = {
  text: string;
  provider: string;
  model: string;
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
};

export function aiConfigured(): boolean {
  return env.mock || Boolean(env.apiKey && env.model);
}

/** Daily per-user budget, counted from AiUsageLog (survives restarts). */
async function assertBudget(actorId: string): Promise<void> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const used = await prisma.aiUsageLog.count({
    where: { actorId, createdAt: { gte: since } },
  });
  if (used >= env.dailyUserLimit) {
    throw errors.rateLimited(
      `Daily AI limit reached (${env.dailyUserLimit} calls). Try again tomorrow.`,
    );
  }
}

async function log(
  actorId: string,
  purpose: AiPurpose,
  entry: {
    provider: string;
    model: string;
    status: "OK" | "ERROR" | "TIMEOUT" | "RATE_LIMITED" | "REFUSED";
    latencyMs: number;
    tokensIn?: number | null;
    tokensOut?: number | null;
    errorCode?: string | null;
  },
): Promise<void> {
  try {
    await prisma.aiUsageLog.create({
      data: {
        actorId,
        purpose,
        provider: entry.provider,
        model: entry.model,
        status: entry.status,
        latencyMs: entry.latencyMs,
        tokensIn: entry.tokensIn ?? null,
        tokensOut: entry.tokensOut ?? null,
        errorCode: entry.errorCode ?? null,
      },
    });
  } catch (error) {
    // Observability must never break the request.
    console.error("[ai] usage log failed:", error);
  }
}

function estimateTokens(text: string): number {
  // Deliberately crude: a real tokenizer would be a dependency for nothing —
  // this only feeds observability, never billing.
  return Math.ceil(text.length / 4);
}

function mockAnswer(messages: AiMessage[], purpose: AiPurpose): string {
  if (purpose === "FEEDBACK") {
    // The reviewer's indicators ARE the content; this just reflows them.
    const last = messages.at(-1)?.content ?? "";
    return (
      "[MOCK MODE — no model was called] Draft generated from your structured " +
      `indicators. Review and edit before finalizing.\n\n${last.slice(0, 600)}`
    );
  }
  return (
    "[MOCK MODE — no model was called] The AI provider is not configured " +
    "(set OPENROUTER_API_KEY or disable AI_MOCK). This stub exists so the " +
    "conversation flow can be tested without a live model."
  );
}

/**
 * One model call. Throws AppError(503) when unconfigured, AppError(429) when
 * the caller is over budget, AppError(503) on provider failure — never
 * returns invented text as if it came from a model.
 */
export async function callAi(params: {
  actorId: string;
  purpose: AiPurpose;
  messages: AiMessage[];
  /** Overrides the env default for one call (chat keeps turns short). */
  maxOutputTokens?: number;
}): Promise<AiResult> {
  const { actorId, purpose, messages } = params;

  const inputChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (inputChars / 4 > env.maxInputTokens) {
    throw errors.validation("Prompt is too long for the configured model.");
  }

  if (!aiConfigured()) {
    await log(actorId, purpose, {
      provider: env.provider,
      model: env.model || "none",
      status: "REFUSED",
      latencyMs: 0,
      errorCode: "AI_UNAVAILABLE",
    });
    throw errors.aiUnavailable(
      "AI_UNAVAILABLE",
      "The AI provider is not configured. Add OPENROUTER_API_KEY or enable AI_MOCK for development.",
    );
  }

  await assertBudget(actorId);

  const started = Date.now();

  if (env.mock) {
    const text = mockAnswer(messages, purpose);
    await log(actorId, purpose, {
      provider: "mock",
      model: "mock",
      status: "OK",
      latencyMs: Date.now() - started,
      tokensIn: estimateTokens(JSON.stringify(messages)),
      tokensOut: estimateTokens(text),
    });
    return {
      text,
      provider: "mock",
      model: "mock",
      latencyMs: Date.now() - started,
      tokensIn: estimateTokens(JSON.stringify(messages)),
      tokensOut: estimateTokens(text),
    };
  }

  let response: Response;
  try {
    response = await fetch(`${env.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.apiKey}`,
        "Content-Type": "application/json",
        // OpenRouter attribution headers (optional but polite).
        "HTTP-Referer": process.env.APP_URL ?? "http://localhost:3000",
        "X-Title": "AI Employee Management System",
      },
      body: JSON.stringify({
        model: env.model,
        messages,
        max_tokens: params.maxOutputTokens ?? env.maxOutputTokens,
      }),
      // A hung model call must fail, not pin a serverless instance.
      signal: AbortSignal.timeout(env.timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    await log(actorId, purpose, {
      provider: env.provider,
      model: env.model,
      status: timedOut ? "TIMEOUT" : "ERROR",
      latencyMs: Date.now() - started,
      errorCode: timedOut ? "AI_TIMEOUT" : "AI_NETWORK",
    });
    throw errors.aiUnavailable(
      timedOut ? "AI_TIMEOUT" : "AI_NETWORK",
      timedOut
        ? "The AI provider timed out. Try a shorter question."
        : "The AI provider could not be reached.",
    );
  }

  const latencyMs = Date.now() - started;

  if (!response.ok) {
    const status = response.status === 429 ? "RATE_LIMITED" : "ERROR";
    await log(actorId, purpose, {
      provider: env.provider,
      model: env.model,
      status,
      latencyMs,
      errorCode: `HTTP_${response.status}`,
    });
    if (response.status === 429) {
      throw errors.rateLimited("The AI provider is rate-limiting requests. Try again shortly.");
    }
    throw errors.aiUnavailable("AI_PROVIDER_ERROR", "The AI provider returned an error.");
  }

  const body = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  } | null;

  const text = body?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    await log(actorId, purpose, {
      provider: env.provider,
      model: env.model,
      status: "ERROR",
      latencyMs,
      errorCode: "AI_EMPTY_RESPONSE",
    });
    throw errors.aiUnavailable("AI_EMPTY_RESPONSE", "The AI provider returned an empty response.");
  }

  await log(actorId, purpose, {
    provider: env.provider,
    model: env.model,
    status: "OK",
    latencyMs,
    tokensIn: body?.usage?.prompt_tokens ?? null,
    tokensOut: body?.usage?.completion_tokens ?? null,
  });

  return {
    text,
    provider: env.provider,
    model: env.model,
    latencyMs,
    tokensIn: body?.usage?.prompt_tokens ?? null,
    tokensOut: body?.usage?.completion_tokens ?? null,
  };
}
