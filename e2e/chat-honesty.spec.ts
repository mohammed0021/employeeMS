import { expect, test } from "@playwright/test";

import { ACCOUNTS, login } from "./helpers";

/**
 * Chat honesty: the app must admit when AI is not configured, fail inline
 * when a message is sent, and never fabricate an assistant reply.
 *
 * The dev server runs without AI_MOCK and with an empty OPENROUTER_API_KEY,
 * so every send legitimately returns 503 AI_UNAVAILABLE — the behaviour under
 * test is the UI's honesty about that failure, not the outage itself.
 *
 * NOTE on selectors: MessageBubble (src/components/chat/chat-ui.tsx:288-329)
 * exposes no role, aria-label or data-* attribute, so "assistant bubble" can
 * only be counted structurally by its classes (a minor a11y gap worth
 * fixing in the product). Every wait around it is still web-first.
 */
test.describe("chat honesty", () => {
  test("unconfigured AI is announced, and a send fails inline without a fake reply", async ({
    page,
  }) => {
    await login(page, ACCOUNTS.employee);
    await page.goto("/chat");

    // The page (role="status" banner) admits up front that no provider is
    // configured — src/app/(dashboard)/chat/page.tsx:39-50.
    await expect(page.getByRole("status").filter({ hasText: "AI is not configured" })).toBeVisible();

    // Start a fresh conversation (the sidebar and the empty state both offer
    // "New chat"; the sidebar one is first in the DOM).
    await page.getByRole("button", { name: "New chat" }).first().click();
    await page.waitForURL(/\/chat\?c=/);

    const question = `What does the policy say about annual leave? E2E ${Date.now()}`;
    await page
      .getByPlaceholder(
        "Ask what the policies say… (Enter to send, Shift+Enter for a new line)",
      )
      .fill(question);
    await page.getByRole("button", { name: "Send" }).click();

    // Inline 503 surfaced in the thread — the API's own message, mentioning
    // the missing provider configuration (src/lib/ai/provider.ts).
    await expect(
      page.getByRole("alert").filter({ hasText: "The AI provider is not configured" }),
    ).toBeVisible();

    // The user's question stays in the transcript (it really was persisted)…
    await expect(page.getByText(question)).toBeVisible();

    // …and NO assistant bubble was invented: exactly one bubble exists in the
    // whole thread (the question), and none of them is an assistant turn
    // (assistant bubbles are the only ones carrying bg-muted).
    await expect(page.locator("div.rounded-2xl")).toHaveCount(1);
    await expect(page.locator("div.rounded-2xl.bg-muted")).toHaveCount(0);

    // The banner is still honest after the failure.
    await expect(page.getByRole("status").filter({ hasText: "AI is not configured" })).toBeVisible();
  });
});
