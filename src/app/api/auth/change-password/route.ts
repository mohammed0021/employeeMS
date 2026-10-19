import { NextRequest, NextResponse } from "next/server";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit/audit";
import { apiHandler, errors } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { requireUser } from "@/lib/auth/guards";
import { revokeUserSessions, SESSION_COOKIE } from "@/lib/auth/session";
import { changePasswordSchema } from "@/lib/validation/auth";

/**
 * Change own password. Revokes ALL sessions (including this one) after a
 * successful change; the client is told to log in again.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const session = await requireUser();
  const input = changePasswordSchema.parse(await request.json());

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) throw errors.notFound("User not found.");

  const valid = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!valid) {
    await recordAudit({
      actor: { id: user.id, role: user.role },
      action: AUDIT_ACTIONS.PASSWORD_CHANGED,
      entityType: "User",
      entityId: user.id,
      outcome: "FAILURE",
      metadata: { reason: "WRONG_CURRENT_PASSWORD" },
    });
    throw errors.validation("Current password is incorrect.");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(input.newPassword) },
  });

  // Revoke every session — a password change invalidates existing logins.
  await revokeUserSessions(user.id);

  await recordAudit({
    actor: { id: user.id, role: user.role },
    action: AUDIT_ACTIONS.PASSWORD_CHANGED,
    entityType: "User",
    entityId: user.id,
  });

  const response = NextResponse.json({ ok: true, reauthRequired: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
});
