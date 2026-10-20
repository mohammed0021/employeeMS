import { expect, test } from "@playwright/test";

import { ACCOUNTS, login, logout, uniqueMarker, utcDateDaysAhead } from "./helpers";

/**
 * End-to-end leave workflow: EMPLOYEE submits a 3-day ANNUAL request ~30 days
 * out, HR finds it in the approval queue by its unique reason, is BLOCKED when
 * rejecting without a reason, and then approves it.
 *
 * One test covers the whole round trip so it runs with a single session per
 * role (login is rate limited) and cannot interleave with other tests. Rows
 * are located by their unique reason text, never by position, because the dev
 * database is shared and already holds real requests.
 *
 * The submit dialog's Field labels ("First day", "Last day", "Type",
 * "Reason") carry htmlFor/id associations
 * (src/components/leave/leave-actions.tsx), so getByLabel() addresses each
 * control directly — this spec previously filled the date inputs
 * positionally because that association was missing.
 *
 * The decision dialog renders "Reason (required)" for REJECTED vs
 * "(optional)" for APPROVED and blocks an empty rejection client-side —
 * asserted below, alongside the server's own refusal, which the dialog
 * surfaces verbatim.
 */
test.describe("leave workflow", () => {
  test("employee2 submits an ANNUAL request and HR blocks an empty rejection, then approves", async ({
    page,
  }) => {
    const reason = uniqueMarker();
    // Two logins, three dialogs and a full round trip exceed the 30s default.
    test.setTimeout(120_000);

    // ── Employee side: submit the request ──────────────────────────────────
    await login(page, ACCOUNTS.employee2);
    await page.goto("/leave");
    await expect(page.getByRole("heading", { name: "My leave", level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "Request leave" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Start ~30 days out, end two days later (3 calendar days inclusive).
    const startDay = utcDateDaysAhead(30);
    const endDay = utcDateDaysAhead(32);
    await dialog.getByLabel("First day").fill(startDay);
    await dialog.getByLabel("Last day").fill(endDay);

    // Confirm the leave type explicitly through the (Base UI) select rather
    // than trusting the ANNUAL default.
    await dialog.getByLabel("Type").click();
    await page.getByRole("option", { name: "Annual", exact: true }).click();

    await dialog.getByLabel("Reason").fill(reason);
    await dialog.getByRole("button", { name: "Submit request" }).click();

    // Success toast (sonner, top-right) + the row lands in "My leave".
    await expect(page.getByText("Leave request submitted.")).toBeVisible();
    const employeeRow = page.getByRole("row").filter({ hasText: reason });
    await expect(employeeRow).toBeVisible();
    await expect(employeeRow.getByText("ANNUAL", { exact: true })).toBeVisible();
    await expect(employeeRow.getByText("PENDING", { exact: true })).toBeVisible();

    // ── Switch to HR (no logout control in the UI — see helpers.logout) ────
    await logout(page);
    await login(page, ACCOUNTS.hr);
    // The queue supports the same search box, so we narrow it to our row
    // instead of scanning whatever else is pending in the shared dev DB.
    await page.goto(`/leave/approvals?q=${encodeURIComponent(reason)}`);
    await expect(page.getByRole("heading", { name: "Leave approvals", level: 1 })).toBeVisible();

    const pendingRow = page.getByRole("row").filter({ hasText: reason });
    await expect(pendingRow).toBeVisible();
    await expect(pendingRow.getByText("PENDING", { exact: true })).toBeVisible();

    // ── Rejecting without a reason must be blocked on the client ───────────
    await pendingRow.getByRole("button", { name: "Reject request" }).click();
    const rejectDialog = page.getByRole("dialog");
    await expect(
      rejectDialog.getByRole("heading", { name: "Reject this request?" }),
    ).toBeVisible();
    // The label spells out that a reason is REQUIRED for a rejection…
    const rejectReason = rejectDialog.getByLabel("Reason (required)");
    await expect(rejectReason).toBeVisible();
    await expect(rejectReason).toHaveAttribute("aria-required", "true");

    await rejectDialog.getByRole("button", { name: "Reject", exact: true }).click();
    // …and an empty reason shows the inline error instead of firing a request.
    await expect(
      rejectDialog
        .getByRole("alert")
        .filter({ hasText: "A reason is required when rejecting a leave request." }),
    ).toBeVisible();
    // The dialog stays open — the rejection was never submitted.
    await expect(rejectDialog).toBeVisible();

    // Close the rejection dialog (both the footer Close and the X are named
    // "Close"; the footer one comes first in the DOM).
    await rejectDialog.getByRole("button", { name: "Close" }).first().click();
    await expect(rejectDialog).toBeHidden();

    // NOTE: while a Base UI modal dialog is open it marks the rest of the page
    // inert/aria-hidden, so page-level role queries (getByRole("row")) match
    // nothing until the dialog closes — that is why the row is re-checked here,
    // once the modal is gone. The request is untouched: still PENDING.
    await expect(pendingRow).toBeVisible();
    await expect(pendingRow.getByText("PENDING", { exact: true })).toBeVisible();

    // ── Approve instead ────────────────────────────────────────────────────
    await pendingRow.getByRole("button", { name: "Approve request" }).click();
    const approveDialog = page.getByRole("dialog");
    await expect(
      approveDialog.getByRole("heading", { name: "Approve this request?" }),
    ).toBeVisible();
    // Same label, "(optional)" wording for an approval.
    await expect(approveDialog.getByLabel("Reason (optional)")).toBeVisible();
    await approveDialog.getByRole("button", { name: "Approve", exact: true }).click();

    await expect(page.getByText("Request approved.")).toBeVisible();
    // The approval queue only lists PENDING rows, so the row leaves it.
    await expect(pendingRow).toHaveCount(0);

    // The org-wide list (HR scope) now shows the decision for the same search.
    await page.goto(`/leave?q=${encodeURIComponent(reason)}`);
    const decidedRow = page.getByRole("row").filter({ hasText: reason });
    await expect(decidedRow).toBeVisible();
    await expect(decidedRow.getByText("APPROVED", { exact: true })).toBeVisible();
  });
});
