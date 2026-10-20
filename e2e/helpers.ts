import type { Page } from "@playwright/test";

/** Seeded dev accounts (prisma/seed.ts + scripts/create-admin.ts). */
export const ACCOUNTS = {
  admin: { email: "admin@example.com", password: "DevAdmin!2026#Strong" },
  hr: { email: "hr@example.com", password: "DemoPass!2026#Strong" },
  employee: { email: "employee@example.com", password: "DemoPass!2026#Strong" },
  employee2: { email: "employee2@example.com", password: "DemoPass!2026#Strong" },
} as const;

export type Account = (typeof ACCOUNTS)[keyof typeof ACCOUNTS];

/**
 * Sign in through the real login form and wait for the /dashboard redirect.
 *
 * Every Playwright test gets a FRESH browser context (empty cookie jar), so
 * no state is carried over between tests — that is the "clear state" step,
 * and it is why `login` always starts at /login.
 *
 * The API rate-limits login attempts to 5 per IP+email per 15 minutes and
 * counts EVERY attempt — successful ones too. The suite therefore spreads its
 * logins across the seeded accounts (at most two per account per run) and
 * reuses one session inside multi-step tests instead of logging in twice.
 */
export async function login(page: Page, account: Account): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

/**
 * Sign out through the real topbar control.
 *
 * The button POSTs /api/auth/logout (which revokes the session row
 * server-side, not just the cookie) and then hard-navigates to /login, so
 * waiting for the /login URL doubles as the assertion that the round-trip
 * completed. Kept as a helper because multi-step tests reuse one session.
 */
export async function logout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/login");
}

/** Unique marker (`E2E run <epoch ms>`) so rows created by tests stand out. */
export function uniqueMarker(): string {
  return `E2E run ${Date.now()}`;
}

/**
 * Calendar date `days` ahead, in UTC, matching the app's YYYY-MM-DD handling
 * (it builds dates with `new Date().toISOString().slice(0, 10)`).
 */
export function utcDateDaysAhead(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
