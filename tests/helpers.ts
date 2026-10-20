/**
 * Shared fixtures + cleanup registry for the integration suite.
 *
 * Every test file:
 *   - builds its own rows through `makeDept` / `makeEmployee` / `makeUser`
 *     (unique names/emails per run, so a crashed previous run cannot collide);
 *   - registers per-fixture deletes via `registerCleanup`;
 *   - calls `runCleanups()` in its own `afterAll`, which runs the registry in
 *     REVERSE registration order — dependants are always registered after
 *     their dependencies (dept → employee → user), so the reverse pass deletes
 *     in dependency order and the disposable branch stays reusable.
 *
 * Actors are built exactly the way the app builds them: a `Session`-shaped
 * fixture fed through `actorFrom` / `employeeScopeFrom` (src/lib/services/actor.ts).
 */
import { expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { hashPassword } from "@/lib/auth/password";
import type { Role } from "@/lib/auth/permissions";
import type { Session } from "@/lib/auth/session";
import {
  actorFrom,
  employeeScopeFrom,
  type Actor,
  type EmployeeScopeActor,
} from "@/lib/services/actor";

// ─── Uniqueness ──────────────────────────────────────────────────────────────

let sequence = 0;

/**
 * Per-run unique fragment: wall-clock + counter, so two runs (or two fixtures
 * in one run) never share an email/department name/content hash.
 */
export function uniqueId(prefix = "it"): string {
  sequence += 1;
  return `${prefix}${Date.now().toString(36)}${sequence.toString(36)}`;
}

// ─── Cleanup registry ────────────────────────────────────────────────────────

type Cleanup = () => Promise<void> | void;

const cleanups: Cleanup[] = [];

/** Queue a delete for this test file's `afterAll` (runs in reverse order). */
export function registerCleanup(fn: Cleanup): void {
  cleanups.push(fn);
}

/**
 * Run every registered cleanup, newest first. A failing cleanup is logged and
 * rethrown afterwards: leaked rows must fail loudly instead of silently
 * poisoning the next test file against the shared database.
 */
export async function runCleanups(): Promise<void> {
  const pending = cleanups.splice(0, cleanups.length).reverse();
  let firstFailure: unknown;
  for (const fn of pending) {
    try {
      await fn();
    } catch (error) {
      firstFailure ??= error;
      console.error("[tests] cleanup failed:", error);
    }
  }
  if (firstFailure !== undefined) throw firstFailure;
}

// ─── Actors ──────────────────────────────────────────────────────────────────

/**
 * A `Session` shaped exactly like the one `getSession()` returns (the raw
 * token/sessionId is irrelevant to services — they only read `session.user`).
 */
export function sessionOf(user: UserFixture): Session {
  return {
    sessionId: `test-session-${user.id}`,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      employeeId: user.employeeId,
      employee: null,
    },
  };
}

/** Plain `Actor` ({id, role}) — the shape services that don't scope take. */
export function actorFor(user: UserFixture): Actor {
  return actorFrom(sessionOf(user));
}

/** `EmployeeScopeActor` — for services scoping by the linked employee. */
export function scopeActorFor(user: UserFixture): EmployeeScopeActor {
  return employeeScopeFrom(sessionOf(user));
}

/** Stand-in admin/HR/employee actor without a DB row (read-only paths). */
export function actorWithRole(role: Role, id = "test-actor"): EmployeeScopeActor {
  return { id, role, employeeId: null };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

export type DeptFixture = { id: string; name: string };

/**
 * Queue the full delete cascade for one employee id: every history row (all
 * Restrict FKs) first, then the attrition rows (Cascade, kept explicit so the
 * intent is visible), then the employee itself.
 *
 * Called by `makeEmployee`; also useful for an employee a test creates through
 * the *service* (`createEmployee`) — those bypass `makeEmployee`'s registry.
 */
export function trackEmployee(id: string): void {
  registerCleanup(async () => {
    await prisma.attritionSignal.deleteMany({ where: { employeeId: id } });
    await prisma.attritionIndicator.deleteMany({ where: { employeeId: id } });
    await prisma.performanceFeedback.deleteMany({ where: { employeeId: id } });
    await prisma.payrollRecord.deleteMany({ where: { employeeId: id } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: id } });
    await prisma.attendance.deleteMany({ where: { employeeId: id } });
    await prisma.employee.deleteMany({ where: { id } });
  });
}

/**
 * Queue the delete cascade for one user id, mirroring `trackEmployee`.
 *
 * For accounts a test creates through the *service* (`createUser`) — those
 * bypass `makeUser`'s registry, and without this the row survives the run.
 */
export function trackUser(id: string): void {
  registerCleanup(async () => {
    await prisma.session.deleteMany({ where: { userId: id } });
    await prisma.chatConversation.deleteMany({ where: { userId: id } });
    await prisma.user.deleteMany({ where: { id } });
  });
}

export async function makeDept(name?: string): Promise<DeptFixture> {
  const row = await prisma.department.create({
    data: { name: name ?? `Dept ${uniqueId("d")}` },
  });
  registerCleanup(async () => {
    // Employees are Restrict: they are registered AFTER this fixture, so the
    // reverse pass deletes them before the department is removed.
    await prisma.department.deleteMany({ where: { id: row.id } });
  });
  return { id: row.id, name: row.name };
}

export type EmployeeFixture = {
  id: string;
  employeeCode: string;
  email: string;
  firstName: string;
  lastName: string;
  departmentId: string;
  salary: string;
};

export type MakeEmployeeOptions = {
  departmentId?: string;
  firstName?: string;
  lastName?: string;
  position?: string;
  /** Exact decimal string — the column is `Decimal(12, 2)`. */
  salary?: string;
  status?: "ACTIVE" | "INACTIVE" | "ON_LEAVE";
  createdById?: string;
};

export async function makeEmployee(
  options: MakeEmployeeOptions = {},
): Promise<EmployeeFixture> {
  const uid = uniqueId("e");
  const departmentId = options.departmentId ?? (await makeDept()).id;
  const row = await prisma.employee.create({
    data: {
      employeeCode: `E${uid}`.slice(0, 40),
      firstName: options.firstName ?? "Test",
      lastName: options.lastName ?? `Employee-${uid}`.slice(0, 80),
      email: `emp-${uid}@example.test`,
      position: options.position ?? "Engineer",
      joinDate: new Date("2024-01-15T00:00:00.000Z"),
      salary: options.salary ?? "5000.00",
      status: options.status ?? "ACTIVE",
      departmentId,
      ...(options.createdById ? { createdById: options.createdById } : {}),
    },
  });

  trackEmployee(row.id);

  return {
    id: row.id,
    employeeCode: row.employeeCode,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    departmentId: row.departmentId,
    salary: row.salary.toString(),
  };
}

export type UserFixture = {
  id: string;
  email: string;
  role: Role;
  status: "ACTIVE" | "DISABLED";
  employeeId: string | null;
  /** Plaintext of the fixture password — only the scrypt hash is stored. */
  password: string;
};

export type MakeUserOptions = {
  role?: Role;
  employeeId?: string | null;
  password?: string;
  email?: string;
  status?: "ACTIVE" | "DISABLED";
};

export async function makeUser(options: MakeUserOptions = {}): Promise<UserFixture> {
  const uid = uniqueId("u");
  const email = options.email ?? `user-${uid}@example.test`;
  // Satisfies the app's password policy (≥10 chars, letter + number) by default.
  const password = options.password ?? `Passw0rd-${uid}`;
  const passwordHash = await hashPassword(password);

  const row = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: options.role ?? "EMPLOYEE",
      status: options.status ?? "ACTIVE",
      ...(options.employeeId ? { employeeId: options.employeeId } : {}),
    },
  });

  registerCleanup(async () => {
    // Session/chat cascade with the user; feedback referencing this user as a
    // reviewer is Restrict, so it must already be gone (registered later →
    // cleaned earlier in the reverse pass).
    await prisma.session.deleteMany({ where: { userId: row.id } });
    await prisma.chatConversation.deleteMany({ where: { userId: row.id } });
    await prisma.user.deleteMany({ where: { id: row.id } });
  });

  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    employeeId: row.employeeId,
    password,
  };
}

// ─── Assertions ──────────────────────────────────────────────────────────────

/**
 * Await a call that must fail with an `AppError`, asserting status (+ code
 * when given) and returning the error for further inspection.
 */
export async function expectAppError(
  call: Promise<unknown>,
  status: number,
  code?: string,
): Promise<AppError> {
  let caught: unknown;
  try {
    await call;
  } catch (error) {
    caught = error;
  }
  expect(caught, "expected the call to reject").toBeInstanceOf(AppError);
  const error = caught as AppError;
  expect(error.status, `unexpected status for ${error.code}: ${error.message}`).toBe(status);
  if (code !== undefined) expect(error.code).toBe(code);
  return error;
}

/**
 * Assert two decimal strings denote the same amount, ignoring scale.
 *
 * `Decimal.toString()` normalizes trailing zeros ("3000.10" → "3000.1"), so
 * sums assembled from raw rows can differ from the `money()`-padded DTO
 * strings by padding alone. This compares VALUE, while still failing loudly
 * on any real difference (float drift would show up here).
 */
export function expectDecimalEq(actual: string, expected: string): void {
  const same = new Prisma.Decimal(actual).equals(new Prisma.Decimal(expected));
  expect(same, `expected ${actual} to equal ${expected}`).toBe(true);
}
