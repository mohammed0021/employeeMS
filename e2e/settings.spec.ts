import { expect, test } from "@playwright/test";

import { ACCOUNTS, login } from "./helpers";

/**
 * Change-password client-side validation.
 *
 * A too-short new password and a mismatched confirmation must both be
 * rejected in the browser: no request leaves the page, no success toast
 * appears, and the seeded credentials are untouched. The test stops at the
 * validation layer on purpose — no password is ever changed.
 */
test.describe("settings / change password", () => {
  test("invalid input never reaches the API", async ({ page }) => {
    const changePasswordCalls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/auth/change-password")) {
        changePasswordCalls.push(`${request.method()} ${request.url()}`);
      }
    });

    await login(page, ACCOUNTS.employee);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Profile & settings", level: 1 })).toBeVisible();

    await page.getByLabel("Current password", { exact: true }).fill(ACCOUNTS.employee.password);
    // Too short (min 10, see changePasswordSchema)…
    await page.getByLabel("New password", { exact: true }).fill("abc123");
    // …and the confirmation does not match it either.
    await page.getByLabel("Confirm new password", { exact: true }).fill("abc1234");

    await page.getByRole("button", { name: "Change password" }).click();

    // Both client-side errors are shown inline under their fields.
    await expect(page.getByText("Password must be at least 10 characters.")).toBeVisible();
    await expect(page.getByText("Passwords do not match.")).toBeVisible();

    // The zod resolver rejected the form, so the fetch was never fired…
    expect(changePasswordCalls).toEqual([]);
    // …no server-side alert appeared (the filter skips Next.js's always-
    // present, empty route-announcer div, which also has role="alert")…
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
    // …and no success toast was raised.
    await expect(page.getByText(/Password changed/)).toHaveCount(0);
  });
});
