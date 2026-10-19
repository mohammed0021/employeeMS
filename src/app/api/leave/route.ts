import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission, requireUser } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { resolveSort } from "@/lib/pagination";
import {
  leaveActorFrom,
  listLeaveRequests,
  submitLeaveRequest,
} from "@/lib/services/leave";
import {
  LEAVE_SORT_COLUMNS,
  parseLeaveListQuery,
  submitLeaveSchema,
  toLeaveSort,
} from "@/lib/validation/leave";

/**
 * GET /api/leave — ADMIN/HR see all (status/type/employeeId/q filters);
 * EMPLOYEE see only their own rows (readOwn, enforced in the service too).
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const probe = await requireUser();
  const session = can(probe.user.role, "leave", "read")
    ? await requirePermission("leave", "read")
    : await requirePermission("leave", "readOwn");
  const query = parseLeaveListQuery(request.nextUrl.searchParams);
  const sort = toLeaveSort(
    resolveSort(request.nextUrl.searchParams, LEAVE_SORT_COLUMNS, "submittedAt"),
  );
  return Response.json(await listLeaveRequests(query, sort, leaveActorFrom(session)));
});

/** POST /api/leave — submit own request (EMPLOYEE only; employeeId from session). */
export const POST = apiHandler(async (request: NextRequest) => {
  const session = await requirePermission("leave", "create");
  const input = submitLeaveSchema.parse(await request.json());
  return Response.json(await submitLeaveRequest(leaveActorFrom(session), input), {
    status: 201,
  });
});
