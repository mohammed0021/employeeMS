import { cookies } from "next/headers";
import { cache } from "react";
import { errors } from "@/lib/errors";
import { can, type Action, type Resource, type Role } from "@/lib/auth/permissions";
import { getSession, SESSION_COOKIE, type Session, type SessionUser } from "./session";

/**
 * Current session, resolved once per request (React `cache`).
 * Every server component, server action and route handler must call this
 * (directly or via requireUser/requireRole) — hiding UI is never the check.
 */
export const currentSession = cache(async (): Promise<Session | null> => {
  const store = await cookies();
  return getSession(store.get(SESSION_COOKIE)?.value);
});

/** Session or throw 401 (API) / redirect handled by caller for pages. */
export async function requireUser(): Promise<Session> {
  const session = await currentSession();
  if (!session) throw errors.unauthorized();
  return session;
}

/** Session restricted to specific roles, else 403. */
export async function requireRole(...roles: Role[]): Promise<Session> {
  const session = await requireUser();
  if (!roles.includes(session.user.role)) {
    throw errors.forbidden();
  }
  return session;
}

/** Session must hold `action` on `resource` per the permission matrix. */
export async function requirePermission(
  resource: Resource,
  action: Action,
): Promise<Session> {
  const session = await requireUser();
  if (!can(session.user.role, resource, action)) {
    throw errors.forbidden();
  }
  return session;
}

/** Non-throwing variant for layouts that render degraded UI instead. */
export async function optionalUser(): Promise<SessionUser | null> {
  const session = await currentSession();
  return session?.user ?? null;
}
