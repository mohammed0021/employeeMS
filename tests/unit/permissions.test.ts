import { describe, expect, it } from "vitest";
import {
  ROLES,
  actionsFor,
  can,
  fullMatrix,
  type Action,
  type Resource,
} from "@/lib/auth/permissions";

const ALL_ACTIONS: Action[] = [
  "create",
  "read",
  "readOwn",
  "update",
  "approve",
  "delete",
  "export",
];

const ALL_RESOURCES: Resource[] = [
  "dashboard",
  "users",
  "employees",
  "departments",
  "attendance",
  "leave",
  "payroll",
  "chat",
  "policies",
  "feedback",
  "attrition",
  "reports",
  "audit",
];

describe("permission matrix", () => {
  it("covers every role × resource combination", () => {
    const rows = fullMatrix();
    expect(rows).toHaveLength(ALL_RESOURCES.length * ROLES.length);
    for (const row of rows) {
      expect(ALL_RESOURCES).toContain(row.resource);
      expect(ROLES).toContain(row.role);
    }
  });

  it("only ADMIN can manage users", () => {
    expect(can("ADMIN", "users", "create")).toBe(true);
    expect(can("ADMIN", "users", "update")).toBe(true);
    expect(can("HR", "users", "create")).toBe(false);
    expect(can("EMPLOYEE", "users", "create")).toBe(false);
    expect(can("EMPLOYEE", "users", "read")).toBe(false);
  });

  it("only ADMIN can read audit logs", () => {
    expect(can("ADMIN", "audit", "read")).toBe(true);
    expect(can("HR", "audit", "read")).toBe(false);
    expect(can("EMPLOYEE", "audit", "read")).toBe(false);
  });

  it("EMPLOYEE can only touch their own records", () => {
    expect(can("EMPLOYEE", "employees", "readOwn")).toBe(true);
    expect(can("EMPLOYEE", "employees", "read")).toBe(false);
    expect(can("EMPLOYEE", "employees", "create")).toBe(false);
    expect(can("EMPLOYEE", "attendance", "readOwn")).toBe(true);
    expect(can("EMPLOYEE", "attendance", "create")).toBe(false);
    expect(can("EMPLOYEE", "payroll", "readOwn")).toBe(true);
    expect(can("EMPLOYEE", "payroll", "read")).toBe(false);
    expect(can("EMPLOYEE", "payroll", "export")).toBe(false);
  });

  it("EMPLOYEE can submit and cancel own leave but never approve", () => {
    expect(can("EMPLOYEE", "leave", "create")).toBe(true);
    expect(can("EMPLOYEE", "leave", "update")).toBe(true);
    expect(can("EMPLOYEE", "leave", "approve")).toBe(false);
    expect(can("EMPLOYEE", "leave", "read")).toBe(false);
    expect(can("EMPLOYEE", "leave", "readOwn")).toBe(true);
  });

  it("ADMIN and HR can approve leave", () => {
    expect(can("ADMIN", "leave", "approve")).toBe(true);
    expect(can("HR", "leave", "approve")).toBe(true);
    expect(can("HR", "leave", "create")).toBe(false);
  });

  it("EMPLOYEE cannot access policy docs, attrition, or feedback creation", () => {
    for (const [resource, action] of [
      ["policies", "create"],
      ["policies", "read"],
      ["attrition", "read"],
      ["feedback", "create"],
      ["feedback", "approve"],
    ] as const) {
      expect(can("EMPLOYEE", resource, action)).toBe(false);
    }
  });

  it("EMPLOYEE can chat but HR-only modules stay closed", () => {
    expect(can("EMPLOYEE", "chat", "create")).toBe(true);
    expect(can("EMPLOYEE", "chat", "read")).toBe(true);
    expect(can("EMPLOYEE", "reports", "readOwn")).toBe(true);
    expect(can("EMPLOYEE", "reports", "export")).toBe(false);
  });

  it("no role except ADMIN/HR where explicitly granted has delete", () => {
    // HR delete is only allowed on department-free HR content: none. HR
    // deactivates employees via `update`; it never hard-deletes.
    const hrDeleteAllowed: Resource[] = ["policies"];
    for (const resource of ALL_RESOURCES) {
      expect(can("HR", resource, "delete")).toBe(hrDeleteAllowed.includes(resource));
      expect(can("EMPLOYEE", resource, "delete")).toBe(false);
    }
    expect(can("ADMIN", "users", "delete")).toBe(true);
  });

  it("every role has a dashboard", () => {
    for (const role of ROLES) {
      expect(can(role, "dashboard", "read")).toBe(true);
    }
  });

  it("actionsFor never returns unknown actions", () => {
    for (const row of fullMatrix()) {
      for (const action of row.actions) {
        expect(ALL_ACTIONS).toContain(action);
      }
    }
  });

  it("EMPLOYEE holds no org-wide read on sensitive resources", () => {
    expect(actionsFor("EMPLOYEE", "users")).toEqual([]);
    expect(actionsFor("EMPLOYEE", "audit")).toEqual([]);
    expect(actionsFor("EMPLOYEE", "attrition")).toEqual([]);
    expect(actionsFor("EMPLOYEE", "policies")).toEqual([]);
  });
});
