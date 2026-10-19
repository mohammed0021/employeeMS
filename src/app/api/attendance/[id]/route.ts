import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission, requireUser } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { employeeScopeFrom } from "@/lib/services/actor";
import { correctAttendance, getAttendance } from "@/lib/services/attendance";
import { correctAttendanceSchema } from "@/lib/validation/attendance";

type Params = { params: Promise<{ id: string }> };

/**
 * ADMIN/HR hold `read`; EMPLOYEE holds only `readOwn` (the service then
 * verifies the row actually belongs to their employee record).
 */
async function requireAttendanceRead() {
  const session = await requireUser();
  const action = can(session.user.role, "attendance", "read") ? "read" : "readOwn";
  return requirePermission("attendance", action);
}

/** GET /api/attendance/:id — ADMIN/HR any record, EMPLOYEE only their own. */
export const GET = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const session = await requireAttendanceRead();
  const { id } = await params;
  return Response.json(
    await getAttendance(id, employeeScopeFrom(session)),
  );
});

/** PATCH /api/attendance/:id — correct a record (ADMIN/HR). */
export const PATCH = apiHandler(async (request: NextRequest, { params }: Params) => {
  const session = await requirePermission("attendance", "update");
  const { id } = await params;
  const input = correctAttendanceSchema.parse(await request.json());
  return Response.json(await correctAttendance(employeeScopeFrom(session), id, input));
});
