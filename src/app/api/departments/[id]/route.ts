import { NextRequest } from "next/server";
import { apiHandler, errors } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guards";
import { actorFrom } from "@/lib/services/actor";
import {
  deleteDepartment,
  getDepartment,
  updateDepartment,
} from "@/lib/services/departments";
import { updateDepartmentSchema } from "@/lib/validation/departments";

type Params = { params: Promise<{ id: string }> };

/** GET /api/departments/:id */
export const GET = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const session = await requirePermission("departments", "read");
  const { id } = await params;
  return Response.json(await getDepartment(id, actorFrom(session)));
});

/** PATCH /api/departments/:id — ADMIN only. */
export const PATCH = apiHandler(async (request: NextRequest, { params }: Params) => {
  const session = await requirePermission("departments", "update");
  const { id } = await params;
  const input = updateDepartmentSchema.parse(await request.json());
  return Response.json(await updateDepartment(actorFrom(session), id, input));
});

/** DELETE /api/departments/:id — ADMIN only; 409 while employees remain. */
export const DELETE = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const session = await requirePermission("departments", "delete");
  const { id } = await params;
  if (!id) throw errors.notFound("Department not found.");
  await deleteDepartment(actorFrom(session), id);
  return new Response(null, { status: 204 });
});
