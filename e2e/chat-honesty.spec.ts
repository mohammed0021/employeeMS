import { expect, test } from "@playwright/test";
import "dotenv/config";

import { ACCOUNTS, login } from "./helpers";

/**
 * Chat honesty: the app must never fabricate an assistant reply.
 *
 * Two legitimate configurations, both asserted here (the branch is chosen
 * from the same env the server reads, loaded via dotenv from the repo's
 * .env):
 *
 *  - UNCONFIGURED (empty OPENROUTER_API_KEY): the page announces that no
 *    provider is configured, a send fails inline with the API's own 503
 *    message, and no assistant bubble is invented.
 *  - CONFIGURED (key present): the page must NOT claim AI is unavailable, a
 *    send must produce exactly one real assistant reply, and the question
 *    must persist in the transcript.
 *
 * The unconfigured branch was the state of the environment during the first
 * full verification run; the configured branch covers the live-provider
 * run. Whichever branch executes, the invariant under test is the same:
 * an answer appears only if the provider actually produced one.
 *
 * NOTE on selectors: MessageBubble (src/components/chat/chat-ui.tsx:288-329)
 * exposes no role, aria-label or data-* attribute, so "assistant bubble" can
 * only be counted structurally by its classes (a minor a11y gap worth
 * fixing in the product). Every wait around it is still web-first.
 */
const AI_CONFIGURED = Boolean(process.env.OPENROUTER_API_KEY);

test.describe("chat honesty", () => {
  test("AI is honest: unconfigured fails inline with no fake reply; configured sends one real reply", async ({
    page,
  }) => {
    await login(page, ACCOUNTS.employee);
    await page.goto("/chat");

    const newChat = () => {
      // Start a fresh conversation (the sidebar and the empty state both
      // offer "New chat"; the sidebar one is first in the DOM).
      return page.getByRole("button", { name: "New chat" }).first().click();
    };
    const composer = page.getByPlaceholder(
      "Ask what the policies say… (Enter to send, Shift+Enter for a new line)",
    );

    if (!AI_CONFIGURED) {
      // The page (role="status" banner) admits up front that no provider is
      // configured — src/app/(dashboard)/chat/page.tsx:39-50.
      await expect(
        page.getByRole("status").filter({ hasText: "AI is not configured" }),
      ).toBeVisible();

      await newChat();
      await page.waitForURL(/\/chat\?c=/);

      const question = `What does the policy say about annual leave? E2E ${Date.now()}`;
      await composer.fill(question);
      await page.getByRole("button", { name: "Send" }).click();

      // Inline 503 surfaced in the thread — the API's own message, mentioning
      // the missing provider configuration (src/lib/ai/provider.ts).
      await expect(
        page.getByRole("alert").filter({ hasText: "The AI provider is not configured" }),
      ).toBeVisible();

      // The user's question stays in the transcript (it really was persisted)…
      await expect(page.getByText(question)).toBeVisible();

      // …and NO assistant bubble was invented: exactly one bubble exists in
      // the whole thread (the question), and none is an assistant turn
      // (assistant bubbles are the only ones carrying bg-muted).
      await expect(page.locator("div.rounded-2xl")).toHaveCount(1);
      await expect(page.locator("div.rounded-2xl.bg-muted")).toHaveCount(0);

      // The banner is still honest after the failure.
      await expect(
        page.getByRole("status").filter({ hasText: "AI is not configured" }),
      ).toBeVisible();
      return;
    }

    // ── Configured: live provider ──────────────────────────────────────────
    // The page must not claim AI is unavailable when a provider exists.
    await expect(
      page.getByRole("status").filter({ hasText: "AI is not configured" }),
    ).toHaveCount(0);

    await newChat();
    await page.waitForURL(/\/chat\?c=/);

    const question = `In one sentence, what does the policy say about annual leave? E2E ${Date.now()}`;
    const send = async () => {
      await composer.fill(question);
      await page.getByRole("button", { name: "Send" }).click();
    };

    test.setTimeout(90_000);
    await send();

    // Exactly ONE real assistant reply arrives (LLM latency — allow it).
    const assistantBubbles = page.locator("div.rounded-2xl.bg-muted");
    const inlineFailure = page.getByRole("alert");

    // Free-tier upstreams hiccup occasionally (429/empty). The product's own
    // guidance is "try again shortly", so one resend mirrors real use — but
    // the invariant is unchanged: a reply must actually arrive, or this test
    // fails. Wait for EITHER outcome first.
    const firstOutcome = await Promise.race([
      assistantBubbles
        .first()
        .waitFor({ state: "visible", timeout: 45_000 })
        .then(() => "reply" as const)
        .catch(() => "timeout" as const),
      inlineFailure
        .first()
        .waitFor({ state: "visible", timeout: 45_000 })
        .then(() => "failure" as const)
        .catch(() => "timeout" as const),
    ]);

    if (firstOutcome === "failure") {
      // One retry, exactly as the inline message advises.
      await send();
      await expect(assistantBubbles).toHaveCount(1, { timeout: 45_000 });
    } else {
      await expect(assistantBubbles).toHaveCount(1, { timeout: 45_000 });
    }
    await expect(assistantBubbles.first()).not.toBeEmpty();

    // The question is persisted alongside it (one or two user turns — a
    // retried send leaves the failed attempt in the transcript, honestly).
    const questionTurns = page.getByText(question);
    expect(await questionTurns.count()).toBeGreaterThanOrEqual(1);
    await expect(questionTurns.first()).toBeVisible();
    const bubbles = await page.locator("div.rounded-2xl").count();
    expect(bubbles).toBeGreaterThanOrEqual(2);
    expect(bubbles).toBeLessThanOrEqual(3);
  });
});
