import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guards";
import { actorFrom } from "@/lib/services/actor";
import { parseListQuery } from "@/lib/pagination";
import { createDepartment, listDepartments } from "@/lib/services/departments";
import { createDepartmentSchema } from "@/lib/validation/departments";

/** GET /api/departments — list (read: ADMIN/HR/EMPLOYEE). */
export const GET = apiHandler(async (request: NextRequest) => {
  const session = await requirePermission("departments", "read");
  const query = parseListQuery(request.nextUrl.searchParams);
  return Response.json(await listDepartments(query, actorFrom(session)));
});

/** POST /api/departments — create (ADMIN only). */
export const POST = apiHandler(async (request: NextRequest) => {
  const session = await requirePermission("departments", "create");
  const input = createDepartmentSchema.parse(await request.json());
  const department = await createDepartment(actorFrom(session), input);
  return Response.json(department, { status: 201 });
});
