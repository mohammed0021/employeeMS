/**
 * Service-layer call context.
 *
 * Services never read cookies themselves (that's the guard's job) — they take
 * an explicit `Actor` so the same business rules are reachable from route
 * handlers, seeds and tests. `Actor` is deliberately `AuditActor`-compatible.
 */
import type { Role } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import type { Viewer } from "@/lib/dto";

export type Actor = {
  id: string;
  role: Role;
};

/** Build the service actor from an authenticated session. */
export function actorFrom(session: Session): Actor {
  return { id: session.user.id, role: session.user.role };
}

/**
 * Actor plus the caller's linked employee record.
 *
 * Every self-scoped domain (employees, attendance, leave, payroll) needs this:
 * `readOwn` row scoping, the leave self-decision ban and the DTO viewer all
 * hinge on *which employee* the caller is, not just which user.
 *
 * The value is deliberately derived from the session and never from a request
 * body. Accepting an `employeeId` from the client would let an HR user scope
 * reads to — and decide requests belonging to — someone else.
 *
 * Shared rather than per-domain because four identical copies is exactly how
 * one of them quietly starts trusting the wrong source.
 */
export type EmployeeScopeActor = Actor & { employeeId: string | null };

export function employeeScopeFrom(session: Session): EmployeeScopeActor {
  return { ...actorFrom(session), employeeId: session.user.employeeId };
}

/**
 * Viewer for the DTO layer (drives salary redaction and payslip visibility).
 */
export function viewerOf(actor: EmployeeScopeActor): Viewer {
  return { role: actor.role, employeeId: actor.employeeId };
}
