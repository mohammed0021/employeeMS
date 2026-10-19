/**
 * Admin user service — account lifecycle for the ADMIN role only.
 *
 * PERMISSIONS.md: enforcement happens "in services, not just the matrix",
 * so every entry point (API, seed, future server action) re-asserts the
 * caller is an ADMIN here, even if a route forgets its `requireRole()`.
 * (The permission matrix has no "users" resource — user management is gated
 * purely by the ADMIN role, mirroring `requireRole("ADMIN")`.)
 *
 * SECURITY RULES baked into this module:
 *  - `passwordHash` NEVER leaves it: every read goes through an explicit
 *    `select`, and the DTO is built field-by-field — no spread of a Prisma
 *    row, so a future `include` cannot accidentally serialize the hash.
 *  - An admin cannot change their own role (lockout/self-escalation guard;
 *    the attempt is audited as FAILURE before it is rejected).
 *  - A password reset always deletes every session of the target user.
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { errors } from "@/lib/errors";
import { hashPassword } from "@/lib/auth/password";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit/audit";
import { offset, paginated, type ListQuery } from "@/lib/pagination";
import type { Actor } from "@/lib/services/actor";
import type { Role } from "@/lib/auth/permissions";
import type {
  AdminUserFilters,
  CreateUserInput,
  ResetPasswordInput,
  UpdateUserInput,
} from "@/lib/validation/admin";

// ─── Actor & guard ───────────────────────────────────────────────────────────

/**
 * Every entry point re-checks the role from the SESSION-DERIVED actor (never
 * a request-body value). This mirrors `requireRole("ADMIN")` at the service
 * layer so a forgotten route guard fails closed, not open.
 */
function assertAdmin(actor: Actor): void {
  if (actor.role !== "ADMIN") throw errors.forbidden();
}

// ─── DTO (the only shape a user row may leave this module in) ────────────────

/** Explicit select: `passwordHash` is not in it and can never be added by a spread. */
const USER_SELECT = {
  id: true,
  email: true,
  role: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
} satisfies Prisma.UserSelect;

export type UserDto = {
  id: string;
  email: string;
  role: Role;
  status: "ACTIVE" | "DISABLED";
  employee: { id: string; employeeCode: string; fullName: string } | null;
  lastLoginAt: string | null;
  createdAt: string;
};

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

/** Build the DTO field-by-field — no `...row`, so the hash cannot ride along. */
function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    employee: row.employee
      ? {
          id: row.employee.id,
          employeeCode: row.employee.employeeCode,
          fullName: `${row.employee.firstName} ${row.employee.lastName}`.trim(),
        }
      : null,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Map Prisma's unique-constraint error to a clean 409 (never leak SQL). */
function rethrowAsConflict(error: unknown, message: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw errors.conflict(message);
  }
  throw error;
}

// ─── Read ────────────────────────────────────────────────────────────────────

export type AdminUserPage = {
  items: UserDto[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
};

/**
 * Paginated account directory for the admin users screen.
 *
 * `passwordHash` never leaves the service (see USER_SELECT/`toUserDto`);
 * `q` searches email and the linked employee's name/code so an admin can
 * find an account the way they'd find the person.
 */
export async function listUsers(
  query: ListQuery,
  filters: AdminUserFilters,
  actor: Actor,
): Promise<AdminUserPage> {
  assertAdmin(actor);

  const where: Prisma.UserWhereInput = {};
  if (filters.role) where.role = filters.role;
  if (filters.status) where.status = filters.status;
  if (query.q) {
    where.OR = [
      { email: { contains: query.q, mode: "insensitive" } },
      { employee: { firstName: { contains: query.q, mode: "insensitive" } } },
      { employee: { lastName: { contains: query.q, mode: "insensitive" } } },
      { employee: { employeeCode: { contains: query.q, mode: "insensitive" } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: USER_SELECT,
      // Newest accounts first; id tie-break keeps paging stable.
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: offset(query),
      take: query.limit,
    }),
    prisma.user.count({ where }),
  ]);

  return paginated(rows.map(toUserDto), total, query);
}

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Create a login account. There is no self-registration in this app — every
 * account is minted here by an ADMIN.
 *
 * The email is checked before the write (and P2002 re-checked atomically by
 * the DB) because `User.email` is `@unique`; the optional `employeeId` is a
 * 1:1 link (`User.employeeId @unique`), so the target employee must exist
 * and must not already have an account. Password is hashed with scrypt via
 * the shared password module — this service never sees a stored hash.
 */
export async function createUser(
  input: CreateUserInput,
  actor: Actor,
): Promise<UserDto> {
  assertAdmin(actor);

  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) throw errors.conflict("An account with this email already exists.");

  if (input.employeeId) {
    const employee = await prisma.employee.findUnique({
      where: { id: input.employeeId },
      select: { id: true, user: { select: { id: true } } },
    });
    if (!employee) throw errors.notFound("Employee not found.");
    if (employee.user) {
      throw errors.conflict("That employee already has an account.");
    }
  }

  const passwordHash = await hashPassword(input.password);

  let row;
  try {
    row = await prisma.user.create({
      data: {
        email: input.email,
        role: input.role,
        passwordHash,
        // status defaults to ACTIVE in the schema.
        ...(input.employeeId ? { employeeId: input.employeeId } : {}),
      },
      select: USER_SELECT,
    });
  } catch (error) {
    // Race on the email (or employeeId) unique constraint → clean 409.
    rethrowAsConflict(error, "An account with this email already exists.");
  }

  // Email/role are not secrets; `linkedEmployee` records the 1:1 link
  // without echoing the id the admin already knows.
  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.USER_CREATED,
    entityType: "User",
    entityId: row.id,
    metadata: {
      userId: row.id,
      email: row.email,
      role: row.role,
      linkedEmployee: row.employee !== null,
    },
  });

  return toUserDto(row);
}

// ─── Update ──────────────────────────────────────────────────────────────────

/**
 * Patch role/status/employee link.
 *
 * SELF-PROTECTION (the crux): an admin changing their OWN role is denied —
 * it is either self-escalation or a one-click lockout of the last admin, and
 * both are irreversible mistakes when made casually from a list screen. The
 * attempt is audited as a FAILURE first, so the trail shows the intent even
 * though nothing was written.
 *
 * Role changes additionally emit `USER_ROLE_CHANGE` (from → to) alongside
 * the generic `USER_UPDATED` field-names entry, because "who had admin and
 * lost it" is the first question in any incident review.
 */
export async function updateUser(
  id: string,
  input: UpdateUserInput,
  actor: Actor,
): Promise<UserDto> {
  assertAdmin(actor);

  const existing = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, employeeId: true },
  });
  if (!existing) throw errors.notFound("User not found.");

  const roleChanging = input.role !== undefined && input.role !== existing.role;
  if (roleChanging && id === actor.id) {
    // Audit the DENIED attempt before throwing — the audit writer never
    // throws, so the 403 below is guaranteed to surface either way.
    await recordAudit({
      actor,
      action: AUDIT_ACTIONS.SELF_ROLE_CHANGE_DENIED,
      entityType: "User",
      entityId: id,
      outcome: "FAILURE",
      metadata: { userId: id, from: existing.role, to: input.role },
    });
    throw errors.forbidden("You cannot change your own role.");
  }

  // Relinking only: `null` (clear) needs no existence check; a new id must
  // point at a real employee that doesn't already have an account elsewhere.
  if (
    input.employeeId !== undefined &&
    input.employeeId !== null &&
    input.employeeId !== existing.employeeId
  ) {
    const employee = await prisma.employee.findUnique({
      where: { id: input.employeeId },
      select: { id: true, user: { select: { id: true } } },
    });
    if (!employee) throw errors.notFound("Employee not found.");
    // Re-linking the employee already attached to THIS user is a no-op.
    if (employee.user && employee.user.id !== id) {
      throw errors.conflict("That employee already has an account.");
    }
  }

  let row;
  try {
    row = await prisma.user.update({
      where: { id },
      data: {
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.employeeId !== undefined ? { employeeId: input.employeeId } : {}),
      },
      select: USER_SELECT,
    });
  } catch (error) {
    // Only employeeId can trip a unique constraint here.
    rethrowAsConflict(error, "That employee already has an account.");
  }

  // Field NAMES only — never values — so the entry cannot leak content.
  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.USER_UPDATED,
    entityType: "User",
    entityId: id,
    metadata: { userId: id, fields: Object.keys(input) },
  });
  if (roleChanging) {
    await recordAudit({
      actor,
      action: AUDIT_ACTIONS.USER_ROLE_CHANGE,
      entityType: "User",
      entityId: id,
      metadata: { userId: id, from: existing.role, to: input.role },
    });
  }

  return toUserDto(row);
}

// ─── Password reset ──────────────────────────────────────────────────────────

/**
 * Admin sets a NEW password for a user (lost-password / compromised-account
 * recovery).
 *
 * WHY THE SESSION WIPE: sessions are opaque cookie tokens valid for up to 7
 * days (sliding). Rotating the hash alone would leave every already-issued
 * cookie working — the whole point of a reset after a compromise is that the
 * OLD credential (and any session minted from it) dies NOW. Deleting every
 * `Session` row for the user forces all devices to re-authenticate with the
 * new password.
 *
 * The password itself (and its hash) is never passed to the audit writer —
 * only the `passwordReset: true` flag, which is what investigators need.
 */
export async function resetPassword(
  id: string,
  input: ResetPasswordInput,
  actor: Actor,
): Promise<void> {
  assertAdmin(actor);

  const existing = await prisma.user.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) throw errors.notFound("User not found.");

  const passwordHash = await hashPassword(input.password);
  await prisma.user.update({ where: { id }, data: { passwordHash } });

  // Kill every live session so a stolen/rotated-away credential cannot keep
  // riding an old cookie until its natural expiry.
  await prisma.session.deleteMany({ where: { userId: id } });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.USER_UPDATED,
    entityType: "User",
    entityId: id,
    metadata: { userId: id, passwordReset: true },
  });
}
