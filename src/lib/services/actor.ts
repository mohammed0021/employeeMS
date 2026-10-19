/**
 * Service-layer call context.
 *
 * Services never read cookies themselves (that's the guard's job) — they take
 * an explicit `Actor` so the same business rules are reachable from route
 * handlers, seeds and tests. `Actor` is deliberately `AuditActor`-compatible.
 */
import type { Role } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";

export type Actor = {
  id: string;
  role: Role;
};

/** Build the service actor from an authenticated session. */
export function actorFrom(session: Session): Actor {
  return { id: session.user.id, role: session.user.role };
}
