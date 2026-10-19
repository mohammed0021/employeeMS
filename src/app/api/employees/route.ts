import { NextRequest } from "next/server";
import { apiHandler, errors } from "@/lib/errors";
import { requirePermission, requireUser } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { parseListQuery, resolveSort } from "@/lib/pagination";
import {
  createEmployee,
  employeeActorFrom,
  listEmployees,
} from "@/lib/services/employees";
import {
  createEmployeeSchema,
  employeeFilterSchema,
  EMPLOYEE_SORT_FIELDS,
} from "@/lib/validation/employees";
import type { Session } from "@/lib/auth/session";

/**
 * Defence in depth alongside the service's own check: a list caller must
 * hold `read` (any employee) or `readOwn` (own record — the service scopes
 * the query to `actor.employeeId`). EMPLOYEE only holds `readOwn`, so a
 * plain `requirePermission("employees", "read")` would deny them their own
 * profile list.
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

/** GET /api/employees — list (read for ADMIN/HR, readOwn-scoped for EMPLOYEE). */
export const GET = apiHandler(async (request: NextRequest) => {
  const session = await requireEmployeeRead();
  const params = request.nextUrl.searchParams;
  const query = parseListQuery(params);
  const filters = employeeFilterSchema.parse({
    q: query.q,
    departmentId: params.get("departmentId"),
    status: params.get("status"),
  });
  const sort = resolveSort(params, EMPLOYEE_SORT_FIELDS, "lastName");
  return Response.json(
    await listEmployees(query, filters, sort, employeeActorFrom(session)),
  );
});

/** POST /api/employees — create (ADMIN/HR). */
export const POST = apiHandler(async (request: NextRequest) => {
  const session = await requirePermission("employees", "create");
  const input = createEmployeeSchema.parse(await request.json());
  return Response.json(await createEmployee(employeeActorFrom(session), input), {
    status: 201,
  });
});
