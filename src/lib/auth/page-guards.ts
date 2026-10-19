import { forbidden, notFound, redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
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

/**
 * Signed in AND holding **at least one** of the listed actions, else the 403 page.
 *
 * Needed because `readOwn` is a distinct matrix action from `read`. A page for
 * a self-scoped module (employees, attendance, leave, payroll) must admit an
 * EMPLOYEE via `readOwn`, while `pagePermission(resource, "read")` alone would
 * bounce them from their own records — the guard is not the scoping; the
 * service still restricts *which rows* they get.
 */
export async function pagePermissionAny(
  resource: Resource,
  ...actions: Action[]
): Promise<Session> {
  const session = await pageUser();
  if (!actions.some((action) => can(session.user.role, resource, action))) {
    forbidden();
  }
  return session;
}

/**
 * Translate a service's `AppError` into the page-world equivalent and rethrow.
 *
 * The same service backs both an API route and a Server Component. In a route,
 * `apiHandler` maps `AppError` to a JSON status code. In a page there is no
 * such wrapper, so the identical error escapes to Next as a generic 500 — an
 * EMPLOYEE probing another employee's URL gets a server error page instead of
 * the 403 they were correctly issued by the service.
 *
 * This keeps the service as the single authority on authorization while giving
 * pages the status they deserve: 401/403 -> forbidden(), 404 -> notFound().
 * Anything else is rethrown untouched so a genuine bug still surfaces.
 */
export function rethrowAsPage(error: unknown): never {
  if (error instanceof AppError) {
    if (error.status === 401 || error.status === 403) forbidden();
    if (error.status === 404) notFound();
  }
  throw error;
}

/**
 * Run a service call in page context, mapping `AppError` to page navigation.
 *
 * `getEmployee(id, actor)` throws 403 before it reveals whether a record
 * exists, so a page must not hand-check ids itself — it calls the service and
 * lets this translate. That way the readOwn rule lives in one place.
 */
export async function pageService<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    rethrowAsPage(error);
  }
}
