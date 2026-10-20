import { expect, test } from "@playwright/test";

import { ACCOUNTS, login } from "./helpers";

/**
 * Role-based access control at the PAGE level.
 *
 * Every denial is enforced server-side (pageRole/pagePermission guards call
 * forbidden(), which renders src/app/forbidden.tsx thanks to
 * experimental.authInterrupts). Hiding nav items is UX only — these tests
 * navigate straight at the URLs.
 *
 * Login rate limits (5 per IP+email per 15 min) push us to group each role's
 * checks into one test: one login per role per run.
 */
test.describe("RBAC", () => {
  test("employee2 is forbidden from Users & roles and Audit logs", async ({ page }) => {
    await login(page, ACCOUNTS.employee2);

    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/admin\/users/);
    await expect(
      page.getByRole("heading", { name: "You don't have access to this page" }),
    ).toBeVisible();
    await expect(page.getByText("403", { exact: true })).toBeVisible();
    // src/app/forbidden.tsx renders the Button with render={<Link/>}, so the
    // control is an anchor, not a button.
    await expect(page.getByRole("link", { name: "Back to dashboard" })).toBeVisible();
    // The admin page itself never rendered — no users table, no page heading.
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Users & roles" })).toHaveCount(0);

    await page.goto("/audit");
    await expect(page).toHaveURL(/\/audit/);
    await expect(
      page.getByRole("heading", { name: "You don't have access to this page" }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("HR is forbidden from Audit logs but may reach Policy documents with the upload action", async ({
    page,
  }) => {
    await login(page, ACCOUNTS.hr);

    await page.goto("/audit");
    await expect(page).toHaveURL(/\/audit/);
    await expect(
      page.getByRole("heading", { name: "You don't have access to this page" }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);

    // HR holds policies create/read (src/lib/auth/permissions.ts), so the
    // module is reachable…
    await page.goto("/admin/policies");
    await expect(page).toHaveURL(/\/admin\/policies/);
    await expect(page.getByRole("heading", { name: "Policy documents", level: 1 })).toBeVisible();
    // …and the upload affordance is rendered for them.
    await expect(page.getByRole("button", { name: "Upload policy" })).toBeVisible();
  });
});
