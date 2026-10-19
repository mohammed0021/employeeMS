import { NextRequest } from "next/server";
import { apiHandler, errors } from "@/lib/errors";
import { requirePermission, requireUser } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import {
  deleteEmployee,
  employeeActorFrom,
  getEmployee,
  updateEmployee,
} from "@/lib/services/employees";
import { updateEmployeeSchema } from "@/lib/validation/employees";
import type { Session } from "@/lib/auth/session";

type Params = { params: Promise<{ id: string }> };

/**
 * Defence in depth alongside the service's own check: `read` (any employee)
 * or `readOwn` (own record only — enforced against `actor.employeeId` in the
 * service). EMPLOYEE only holds `readOwn`, so a plain
 * `requirePermission("employees", "read")` would deny them their own record.
 */
async function requireEmployeeRead(): Promise<Session> {
  const session = await requireUser();
  if (
    !can(session.user.role, "employees", "read") &&
    !can(session.user.role, "employees", "readOwn")
  ) {
    throw errors.forbidden();
  }
  return session;
}

/** GET /api/employees/:id — ADMIN/HR any record; EMPLOYEE only their own. */
export const GET = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const session = await requireEmployeeRead();
  const { id } = await params;
  return Response.json(await getEmployee(id, employeeActorFrom(session)));
});

/** PATCH /api/employees/:id — ADMIN/HR; INACTIVE transitions audit deactivation. */
export const PATCH = apiHandler(async (request: NextRequest, { params }: Params) => {
  const session = await requirePermission("employees", "update");
  const { id } = await params;
  const input = updateEmployeeSchema.parse(await request.json());
  return Response.json(await updateEmployee(employeeActorFrom(session), id, input));
});

/** DELETE /api/employees/:id — ADMIN only; 409 while history rows exist. */
export const DELETE = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const session = await requirePermission("employees", "delete");
  const { id } = await params;
  if (!id) throw errors.notFound("Employee not found.");
  await deleteEmployee(employeeActorFrom(session), id);
  return new Response(null, { status: 204 });
});
