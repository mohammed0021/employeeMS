import { forbidden, redirect } from "next/navigation";
import { can, type Action, type Resource, type Role } from "@/lib/auth/permissions";
import { currentSession } from "./guards";
import type { Session } from "./session";

/**
 * Page-context guards.
 *
 * API routes throw AppError (handled by apiHandler → JSON status codes).
 * Pages instead trigger Next's forbidden() (renders src/app/forbidden.tsx)
 * or redirect() — AppError would otherwise surface as a generic 500.
 */

/** Signed-in user or redirect to /login. */
export async function pageUser(): Promise<Session> {
  const session = await currentSession();
  if (!session) redirect("/login");
  return session;
}

/** Signed in AND role allowed, else the 403 page. */
export async function pageRole(...roles: Role[]): Promise<Session> {
  const session = await pageUser();
  if (!roles.includes(session.user.role)) forbidden();
  return session;
}

/** Signed in AND permission held per matrix, else the 403 page. */
export async function pagePermission(
  resource: Resource,
  action: Action,
): Promise<Session> {
  const session = await pageUser();
  if (!can(session.user.role, resource, action)) forbidden();
  return session;
}
