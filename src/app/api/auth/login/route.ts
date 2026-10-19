import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit/audit";
import { errors, apiHandler } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import {
  createSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "@/lib/auth/session";
import { enforceRateLimit, loginKey, RATE_LIMITS } from "@/lib/auth/rate-limit";
import { loginSchema } from "@/lib/validation/auth";

async function clientIp(request: NextRequest): Promise<string> {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export const POST = apiHandler(async (request: NextRequest) => {
  const body = await request.json();
  const input: z.infer<typeof loginSchema> = loginSchema.parse(body);

  const ip = await clientIp(request);

  // Rate limit BEFORE touching the user record (brute-force protection).
  try {
    await enforceRateLimit(
      loginKey(ip, input.email),
      RATE_LIMITS.login.limit,
      RATE_LIMITS.login.windowMs,
    );
  } catch (error) {
    await recordAudit({
      actor: null,
      action: AUDIT_ACTIONS.LOGIN_FAILURE,
      entityType: "Session",
      outcome: "FAILURE",
      metadata: { email: input.email, reason: "RATE_LIMITED" },
    });
    throw error;
  }

  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { employee: { select: { id: true, firstName: true, lastName: true } } },
  });

  // Same error + comparable timing path for unknown user and bad password.
  const valid = user
    ? await verifyPassword(input.password, user.passwordHash)
    : await verifyPassword(input.password, "scrypt$32768$8$1$AAAA$AAAA");

  if (!user || !valid) {
    await recordAudit({
      actor: null,
      action: AUDIT_ACTIONS.LOGIN_FAILURE,
      entityType: "Session",
      outcome: "FAILURE",
      metadata: { email: input.email, reason: "INVALID_CREDENTIALS" },
    });
    // Never reveal which field was wrong.
    throw errors.unauthorized();
  }

  if (user.status !== "ACTIVE") {
    await recordAudit({
      actor: { id: user.id, role: user.role },
      action: AUDIT_ACTIONS.LOGIN_FAILURE,
      entityType: "Session",
      outcome: "FAILURE",
      metadata: { reason: "ACCOUNT_DISABLED" },
    });
    throw errors.forbidden("This account has been deactivated.");
  }

  const { token, expiresAt } = await createSession(user.id);
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await recordAudit({
    actor: { id: user.id, role: user.role },
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    entityType: "Session",
    entityId: user.id,
    metadata: { role: user.role },
  });

  const response = NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      employee: user.employee,
    },
  });

  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  return response;
});
