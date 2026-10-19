import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guards";
import { actorFrom } from "@/lib/services/actor";
import { deletePolicy, getPolicy } from "@/lib/services/policies";

type Params = { params: Promise<{ id: string }> };

/** GET /api/policies/:id — read: ADMIN/HR only. */
export const GET = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const session = await requirePermission("policies", "read");
  const { id } = await params;
  return Response.json(await getPolicy(id, actorFrom(session)));
});

/** DELETE /api/policies/:id — delete: ADMIN/HR only; chunks cascade. */
export const DELETE = apiHandler(async (_request: NextRequest, { params }: Params) => {
  const session = await requirePermission("policies", "delete");
  const { id } = await params;
  await deletePolicy(id, actorFrom(session));
  return new Response(null, { status: 204 });
});
