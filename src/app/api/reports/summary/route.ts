import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission, requireUser } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { employeeScopeFrom } from "@/lib/services/actor";
import { computeOwnSummary, computeSummary } from "@/lib/services/reports";
import { reportRangeSchema } from "@/lib/validation/reports";

/**
 * GET /api/reports/summary — org-wide figures for ADMIN/HR (`read`), or the
 * caller's own attendance/leave/payroll summary for EMPLOYEE (`readOwn`).
 *
 * Probe pattern (same as /api/leave): the shared guard exposes one action
 * per call, so a 403 from the org-wide action is retried with the
 * self-scoped one. The service re-checks the action AND scopes the queries
 * to `actor.employeeId`, so the route stays thin.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const probe = await requireUser();
  const session = can(probe.user.role, "reports", "read")
    ? await requirePermission("reports", "read")
    : await requirePermission("reports", "readOwn");
  const range = reportRangeSchema.parse({
    from: request.nextUrl.searchParams.get("from") ?? undefined,
    to: request.nextUrl.searchParams.get("to") ?? undefined,
  });
  const actor = employeeScopeFrom(session);
  return Response.json(
    can(session.user.role, "reports", "read")
      ? await computeSummary(range, actor)
      : await computeOwnSummary(range, actor),
  );
});
