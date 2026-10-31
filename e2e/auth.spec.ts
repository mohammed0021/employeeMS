import { expect, test } from "@playwright/test";

import { ACCOUNTS, login, logout } from "./helpers";

/**
 * Authentication: credential rejection, the sign-in → dashboard happy path,
 * logout, and the unauthenticated redirect.
 *
 * Login attempts are rate limited (5 per IP+email per 15 minutes, counting
 * every attempt), so this suite deliberately uses the wrong-password form
 * exactly once per run, against a non-seeded email.
 */
test.describe("authentication", () => {
  test("wrong password shows an inline error and stays on the sign-in page", async ({
    page,
  }) => {
    await page.goto("/login");
    // Deliberately NOT a seeded account: the rate limiter is keyed per
    // IP+email and counts every attempt, so burning a seeded account's
    // 5-per-15-min budget on a deliberate failure would make repeated suite
    // runs flaky. The endpoint treats an unknown email and a bad password
    // identically by design (src/app/api/auth/login/route.ts:52-66).
    const email = "e2e-wrong-password@example.com";
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    // 401 UNAUTHORIZED is surfaced verbatim inside the form's alert box
    // (src/lib/errors.ts: "Please sign in."). The filter skips Next.js's
    // always-present (and empty) route-announcer div, which also has
    // role="alert".
    await expect(page.getByRole("alert").filter({ hasText: "Please sign in." })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    // Still on the form with the typed email — no session was created.
    await expect(page.getByLabel("Email")).toHaveValue(email);
  });

  test("admin signs in, reaches the dashboard, and is back on /login after logout", async ({
    page,
  }) => {
    await login(page, ACCOUNTS.admin);

    // Dashboard heading + the role-scoped shell (admin-only nav item).
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    // The shell header badge shows the signed-in user's role (the dashboard
    // page renders a second one, hence the header scope).
    await expect(page.locator("header").getByText("Administrator", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Users & roles" })).toBeVisible();

    // FR10: the dashboard reads live aggregates from the reports service, so
    // every stat card carries a counted value rather than the Phase-1 `—`
    // placeholder, and the sign-in that just happened is already audited.
    await expect(page.getByText("Recent activity", { exact: true })).toBeVisible();
    await expect(page.getByText("No audit events recorded yet.")).toHaveCount(0);
    await expect(page.getByText(/^—$/)).toHaveCount(0);
    await expect(page.getByText(/last 30 days/)).toBeVisible();

    // Logout now goes through the real topbar control (SignOutButton), which
    // revokes the session server-side before clearing the cookie.
    await logout(page);

    // The cleared cookie means /dashboard now bounces back to the sign-in page.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("unauthenticated visit to /dashboard redirects to /login", async ({ page }) => {
    await page.goto("/dashboard");

    // src/proxy.ts keeps the return path so login can send the user back.
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});
