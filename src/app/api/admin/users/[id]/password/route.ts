import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requireRole } from "@/lib/auth/guards";
import { actorFrom } from "@/lib/services/actor";
import { resetPassword } from "@/lib/services/admin-users";
import { resetPasswordSchema } from "@/lib/validation/admin";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/users/:id/password — admin password reset → 204.
 *
 * The service re-hashes the password and deletes every session of the
 * target user, so a compromised credential cannot keep living in an old
 * cookie. Nothing is returned: the new password never echoes back.
 */
export const POST = apiHandler(async (request: NextRequest, { params }: Params) => {
  const session = await requireRole("ADMIN");
  const { id } = await params;
  const input = resetPasswordSchema.parse(await request.json());
  await resetPassword(id, input, actorFrom(session));
  return new Response(null, { status: 204 });
});
