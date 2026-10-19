import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Role, UserStatus } from "@/generated/prisma/enums";

export const SESSION_COOKIE = "ems_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days sliding
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000; // avoid a write per request

export type SessionUser = {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  employeeId: string | null;
  employee: { id: string; firstName: string; lastName: string } | null;
};

export type Session = {
  sessionId: string;
  user: SessionUser;
};

function hashToken(token: string): string {
  // SHA-256 of the opaque token — raw tokens never touch the database.
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Create a session for a user. Returns the raw token (goes into the HttpOnly
 * cookie) and its expiry. Only the hash is persisted.
 */
export async function createSession(userId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

/**
 * Resolve a raw cookie token to a live session.
 * Returns null when missing, expired, revoked, or the user is disabled —
 * account status is re-checked on every request.
 */
export async function getSession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          employee: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });

  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    // Lazy cleanup of the expired row.
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (session.user.status !== "ACTIVE") return null;

  // Sliding expiry with throttled persistence.
  const now = Date.now();
  if (now - session.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
    const nextExpiry = new Date(now + SESSION_TTL_MS);
    await prisma.session
      .update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(now), expiresAt: nextExpiry },
      })
      .catch(() => {});
  }

  return {
    sessionId: session.id,
    user: {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role,
      status: session.user.status,
      employeeId: session.user.employeeId,
      employee: session.user.employee,
    },
  };
}

/** Revoke one session (logout). Idempotent. */
export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.session
    .deleteMany({ where: { tokenHash: hashToken(token) } })
    .catch(() => {});
}

/** Revoke every session of a user (password change, deactivation). */
export async function revokeUserSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } }).catch(() => {});
}
