import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requireRole } from "@/lib/auth/guards";
import { parseListQuery } from "@/lib/pagination";
import { actorFrom } from "@/lib/services/actor";
import { createUser, listUsers } from "@/lib/services/admin-users";
import { adminUserFilterSchema, createUserSchema } from "@/lib/validation/admin";

/**
 * GET /api/admin/users — account directory (ADMIN only).
 *
 * `requireRole("ADMIN")` rather than a matrix action: there is no "users"
 * resource in the permission matrix — user management is ADMIN-by-role. The
 * service re-asserts the role from the session-derived actor as well, so a
 * forgotten guard here would still fail closed.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const session = await requireRole("ADMIN");
  const params = request.nextUrl.searchParams;
  const query = parseListQuery(params);
  const filters = adminUserFilterSchema.parse({
    role: params.get("role") ?? undefined,
    status: params.get("status") ?? undefined,
  });
  return Response.json(await listUsers(query, filters, actorFrom(session)));
});

/** POST /api/admin/users — create an account (ADMIN only) → 201. */
export const POST = apiHandler(async (request: NextRequest) => {
  const session = await requireRole("ADMIN");
  const input = createUserSchema.parse(await request.json());
  return Response.json(await createUser(input, actorFrom(session)), {
    status: 201,
  });
});
