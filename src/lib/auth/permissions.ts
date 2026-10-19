/**
 * Central permission matrix — the ONLY source of truth for authorization.
 *
 * Used by:
 *  - server guards (src/lib/auth/guards.ts) for enforcement
 *  - nav config (src/components/layout/nav-config.ts) for UI visibility
 *
 * Hiding a nav item is UX only; every server component, route handler and
 * service entry point must call requireRole()/requireUser() as well.
 */

export const ROLES = ["ADMIN", "HR", "EMPLOYEE"] as const;
export type Role = (typeof ROLES)[number];

export type Action = "create" | "read" | "readOwn" | "update" | "approve" | "delete" | "export";

export type Resource =
  | "dashboard"
  | "users"
  | "employees"
  | "departments"
  | "attendance"
  | "leave"
  | "payroll"
  | "chat"
  | "policies"
  | "feedback"
  | "attrition"
  | "reports"
  | "audit";

type Matrix = Readonly<Record<Resource, Readonly<Record<Role, ReadonlySet<Action> | null>>>>;

const set = (...actions: Action[]): ReadonlySet<Action> => new Set(actions);

const MATRIX: Matrix = {
  // role-scoped dashboards: everyone has one
  dashboard: { ADMIN: set("read"), HR: set("read"), EMPLOYEE: set("read") },

  users: { ADMIN: set("create", "read", "update", "delete"), HR: null, EMPLOYEE: null },

  employees: {
    ADMIN: set("create", "read", "update", "delete", "export"),
    HR: set("create", "read", "update", "export"),
    EMPLOYEE: set("readOwn"),
  },

  departments: {
    ADMIN: set("create", "read", "update", "delete"),
    HR: set("read"),
    EMPLOYEE: set("read"),
  },

  attendance: {
    ADMIN: set("create", "read", "update", "export"),
    HR: set("create", "read", "update", "export"),
    EMPLOYEE: set("readOwn"),
  },

  leave: {
    ADMIN: set("read", "approve", "export"),
    HR: set("read", "approve", "export"),
    EMPLOYEE: set("create", "readOwn", "update"),
  },

  payroll: {
    ADMIN: set("create", "read", "update", "delete", "export"),
    HR: set("create", "read", "update", "export"),
    EMPLOYEE: set("readOwn"),
  },

  chat: { ADMIN: set("create", "read"), HR: set("create", "read"), EMPLOYEE: set("create", "read") },

  policies: {
    ADMIN: set("create", "read", "update", "delete"),
    HR: set("create", "read", "update", "delete"),
    EMPLOYEE: null,
  },

  feedback: {
    ADMIN: set("create", "read", "update", "approve"),
    HR: set("create", "read", "update", "approve"),
    EMPLOYEE: set("readOwn"),
  },

  attrition: {
    ADMIN: set("create", "read", "update"),
    HR: set("create", "read", "update"),
    EMPLOYEE: null,
  },

  reports: {
    ADMIN: set("read", "export"),
    HR: set("read", "export"),
    EMPLOYEE: set("readOwn"),
  },

  audit: { ADMIN: set("read"), HR: null, EMPLOYEE: null },
};

/** Does `role` hold `action` on `resource`? */
export function can(role: Role, resource: Resource, action: Action): boolean {
  const actions = MATRIX[resource][role];
  return actions !== null && actions.has(action);
}

/** Every action a role holds on a resource — used for tests and docs. */
export function actionsFor(role: Role, resource: Resource): Action[] {
  return [...(MATRIX[resource][role] ?? [])];
}

/**
 * The full matrix as plain data (for docs generation and exhaustive tests).
 */
export function fullMatrix(): Array<{
  resource: Resource;
  role: Role;
  actions: Action[];
}> {
  const out: Array<{ resource: Resource; role: Role; actions: Action[] }> = [];
  for (const resource of Object.keys(MATRIX) as Resource[]) {
    for (const role of ROLES) {
      out.push({ resource, role, actions: actionsFor(role, resource) });
    }
  }
  return out;
}
