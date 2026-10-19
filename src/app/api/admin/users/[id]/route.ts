import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requireRole } from "@/lib/auth/guards";
import { actorFrom } from "@/lib/services/actor";
import { updateUser } from "@/lib/services/admin-users";
import { updateUserSchema } from "@/lib/validation/admin";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/users/:id — role/status/employee-link changes (ADMIN only).
 *
 * The service also re-checks the ADMIN role and denies self role changes
 * (with an audit FAILURE entry) even if this guard were ever removed.
 */
export const PATCH = apiHandler(async (request: NextRequest, { params }: Params) => {
  const session = await requireRole("ADMIN");
  const { id } = await params;
  const input = updateUserSchema.parse(await request.json());
  return Response.json(await updateUser(id, input, actorFrom(session)));
});
