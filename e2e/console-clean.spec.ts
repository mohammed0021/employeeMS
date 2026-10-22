import { expect, test } from "@playwright/test";

import { ACCOUNTS, login } from "./helpers";

/**
 * Console cleanliness + link semantics guard for the Base UI Button wrapper.
 *
 * Button (src/components/ui/button.tsx) takes two paths: a plain native
 * <button> (no `render`, or a button-typed element) goes through Base UI,
 * while any other element supplied via `render` — this app renders
 * navigational controls as `render={<Link/>}`, which yields an <a> — is
 * cloned with our button styling (the shadcn slot pattern) instead. The
 * slot path exists because Base UI validates against the REAL DOM node and
 * offers two wrong answers for a link: the `nativeButton` default (true)
 * warns "expected a native <button>", and `nativeButton={false}` silences
 * the warning by injecting role="button" onto the anchor, mislabelling
 * navigation for assistive tech (the RBAC spec asserts these controls stay
 * role="link" — that assertion is the contract).
 *
 * The reports page triggered the warning twice (the range-reset link and
 * the export button map), which is what surfaced the defect. Visiting the
 * pages that use `render` most heavily and asserting the console stays
 * clean guards the wrapper's element classification for all ~20 call sites
 * at once, and the reports reset control is then asserted to resolve as a
 * link — both properties pinned at the defect site.
 *
 * One test, one admin login, on purpose: login attempts are rate-limited
 * per IP+email (5 / 15 min, DB-backed — see src/lib/auth/rate-limit.ts)
 * and the whole suite shares that budget. A blocked login shows "Too many
 * attempts" and makes the login helper hang until the test timeout.
 */
test.describe("console cleanliness", () => {
  test("Base UI Button emits no nativeButton warning and Link controls stay links", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() !== "error" && message.type() !== "warning") return;
      const text = message.text();
      if (text.includes("nativeButton") || text.includes("expected a native")) {
        warnings.push(`${message.type()}: ${text.slice(0, 220)}`);
      }
    });

    await login(page, ACCOUNTS.admin);

    // Pages chosen for their `render` density: reports maps export links,
    // lists carry export + reset links, pagination renders a link per page.
    for (const path of ["/reports", "/employees", "/leave", "/audit", "/dashboard"]) {
      await page.goto(path);
      // Settle signal: the shell renders two <main> elements (the sidebar
      // inset and the page body), so target the heading instead of a bare
      // "main" locator, then give deferred console output a moment to land.
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForTimeout(300);
    }

    expect(warnings, `Base UI Button warnings:\n${warnings.join("\n")}`).toEqual([]);

    // The range-reset control (the first site that raised the warning) is a
    // real anchor: role="link" comes from the element itself. If the wrapper
    // ever regresses to Base UI's nativeButton={false} path, Base UI injects
    // role="button" and this lookup stops matching — exactly how the RBAC
    // spec caught that variant of the regression.
    await page.goto("/reports");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Reset to last 30 days" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Reset to last 30 days" }),
    ).toHaveCount(0);
  });
});
