import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission, requireUser } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { employeeScopeFrom } from "@/lib/services/actor";
import { parseListQuery, resolveSort } from "@/lib/pagination";
import { listAttendance, recordAttendance } from "@/lib/services/attendance";
import {
  ATTENDANCE_SORT_FIELDS,
  attendanceListFiltersSchema,
  recordAttendanceSchema,
} from "@/lib/validation/attendance";

/**
 * ADMIN/HR hold `read`; EMPLOYEE holds only `readOwn` (own history). Both may
 * hit the list — the service scopes EMPLOYEE to their own employee record.
 */
async function requireAttendanceRead() {
  const session = await requireUser();
  const action = can(session.user.role, "attendance", "read") ? "read" : "readOwn";
  return requirePermission("attendance", action);
}

/** GET /api/attendance — list (ADMIN/HR any, EMPLOYEE own history). */
export const GET = apiHandler(async (request: NextRequest) => {
  const session = await requireAttendanceRead();
  const params = request.nextUrl.searchParams;
  const query = parseListQuery(params);
  const filters = attendanceListFiltersSchema.parse({
    dateFrom: params.get("dateFrom") ?? undefined,
    dateTo: params.get("dateTo") ?? undefined,
    employeeId: params.get("employeeId") ?? undefined,
    status: params.get("status") ?? undefined,
  });
  const sort = resolveSort(params, new Set(ATTENDANCE_SORT_FIELDS), "date");
  return Response.json(
    await listAttendance(query, filters, sort, employeeScopeFrom(session)),
  );
});

/** POST /api/attendance — record a day's attendance (ADMIN/HR). */
export const POST = apiHandler(async (request: NextRequest) => {
  const session = await requirePermission("attendance", "create");
  const input = recordAttendanceSchema.parse(await request.json());
  return Response.json(await recordAttendance(employeeScopeFrom(session), input), { status: 201 });
});
