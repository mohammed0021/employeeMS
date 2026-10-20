/**
 * Leave service — RBAC + STATE MACHINE + audit live here, not in the route
 * handler (PERMISSIONS.md: enforcement happens "in services, not just this
 * matrix"), so every entry point is covered even if a caller forgets its
 * `requirePermission()` check.
 *
 * State machine:
 *   PENDING → APPROVED | REJECTED   (an approver: ADMIN/HR)
 *   PENDING → CANCELLED             (the owning employee)
 * Anything else is a 409 that names the current status.
 *
 * HARD RULE 3: an employee can never decide their OWN leave request. The
 * check runs here — before any state transition is applied — and applies
 * even to HR/ADMIN users who happen to be the subject of the request.
 */
import { prisma } from "@/lib/prisma";
import { errors } from "@/lib/errors";
import { can } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit/audit";
import { paginated, type ListQuery } from "@/lib/pagination";
import { toLeaveRequestDto, type LeaveRequestDto } from "@/lib/dto";
import { employeeScopeFrom, type Actor, type EmployeeScopeActor } from "@/lib/services/actor";
import type { Prisma } from "@/generated/prisma/client";
import type {
  LeaveListQuery,
  LeaveSort,
  SubmitLeaveInput,
} from "@/lib/validation/leave";

/**
 * Service actor for leave: the standard actor plus the employee profile the
 * user is linked to (null for admin/HR accounts without one). Scoping and the
 * self-decision rule both hinge on this field, never on request-body values.
 * Single-sourced in src/lib/services/actor.ts.
 */
export type LeaveActor = EmployeeScopeActor;

export const leaveActorFrom = employeeScopeFrom;

type LeaveAction = "read" | "readOwn" | "create" | "update" | "approve";

function assert(actor: Actor, action: LeaveAction) {
  if (!can(actor.role, "leave", action)) throw errors.forbidden();
}

/** Embedded employee reference (compact — salaries never leave the DTO layer). */
const EMPLOYEE_INCLUDE = {
  employee: { include: { department: { select: { id: true, name: true } } } },
} satisfies Prisma.LeaveRequestInclude;

/**
 * `@db.Date` columns are calendar dates: anchor them at UTC midnight so the
 * server timezone can never shift the stored day, and reject values that are
 * not real calendar dates (e.g. 2026-02-31 would silently roll over).
 */
function parseCalendarDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw errors.validation(`Invalid calendar date: ${value}.`);
  }
  return date;
}

function orderByFor(sort: LeaveSort): Prisma.LeaveRequestOrderByWithRelationInput {
  switch (sort.field) {
    case "startDate":
      return { startDate: sort.dir };
    case "endDate":
      return { endDate: sort.dir };
    case "status":
      return { status: sort.dir };
    default:
      return { submittedAt: sort.dir };
  }
}

// ─── Queries ────────────────────────────────────────────────────────────────

export async function listLeaveRequests(
  query: LeaveListQuery,
  sort: LeaveSort,
  actor: LeaveActor,
): Promise<{
  items: LeaveRequestDto[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}> {
  const canSeeAll = can(actor.role, "leave", "read");
  if (!canSeeAll && !can(actor.role, "leave", "readOwn")) throw errors.forbidden();

  // Shared filters. The employeeId filter only applies to org-wide readers:
  // an EMPLOYEE's scope always wins (hard rule 4), so it is not a filter.
  const filters: Prisma.LeaveRequestWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(canSeeAll && query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(query.q
      ? {
          OR: [
            { reason: { contains: query.q, mode: "insensitive" } },
            {
              employee: {
                is: {
                  OR: [
                    { firstName: { contains: query.q, mode: "insensitive" } },
                    { lastName: { contains: query.q, mode: "insensitive" } },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };

  const ownEmployeeId = actor.employeeId;
  let where: Prisma.LeaveRequestWhereInput;
  if (canSeeAll) {
    where = filters;
  } else if (ownEmployeeId !== null) {
    where = { ...filters, employeeId: ownEmployeeId };
  } else {
    // readOwn but no linked employee → nothing can belong to them.
    return paginated<LeaveRequestDto>([], 0, query);
  }

  const [rows, total] = await Promise.all([
    prisma.leaveRequest.findMany({
      where,
      orderBy: orderByFor(sort),
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: EMPLOYEE_INCLUDE,
    }),
    prisma.leaveRequest.count({ where }),
  ]);

  return paginated(rows.map(toLeaveRequestDto), total, query);
}

export async function getLeaveRequest(id: string, actor: LeaveActor): Promise<LeaveRequestDto> {
  const canReadAll = can(actor.role, "leave", "read");
  if (!canReadAll && !can(actor.role, "leave", "readOwn")) throw errors.forbidden();

  const row = await prisma.leaveRequest.findUnique({
    where: { id },
    include: EMPLOYEE_INCLUDE,
  });
  if (!row) throw errors.notFound("Leave request not found.");
  if (!canReadAll && row.employeeId !== actor.employeeId) throw errors.forbidden();
  return toLeaveRequestDto(row);
}

/** Approval queue for approvers (ADMIN/HR): PENDING requests only. */
export async function listPendingApprovals(query: ListQuery, actor: Actor): Promise<{
  items: LeaveRequestDto[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}> {
  assert(actor, "approve");

  const where: Prisma.LeaveRequestWhereInput = { status: "PENDING" };
  const [rows, total] = await Promise.all([
    prisma.leaveRequest.findMany({
      where,
      // Oldest planned leave first — the natural triage order.
      orderBy: { startDate: "asc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: EMPLOYEE_INCLUDE,
    }),
    prisma.leaveRequest.count({ where }),
  ]);

  return paginated(rows.map(toLeaveRequestDto), total, query);
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Submit a leave request. The employeeId comes from the SESSION (via the
 * actor), never from the body — an employee must not submit on someone
 * else's behalf, and a user without a linked employee gets a 403.
 */
export async function submitLeaveRequest(
  actor: LeaveActor,
  input: SubmitLeaveInput,
): Promise<LeaveRequestDto> {
  assert(actor, "create");

  const employeeId = actor.employeeId;
  if (!employeeId) {
    throw errors.forbidden(
      "Your account is not linked to an employee profile, so leave cannot be submitted.",
    );
  }

  const startDate = parseCalendarDate(input.startDate);
  const endDate = parseCalendarDate(input.endDate);
  if (endDate.getTime() < startDate.getTime()) {
    throw errors.validation("End date must be on or after the start date.");
  }

  const row = await prisma.leaveRequest.create({
    data: {
      employeeId,
      startDate,
      endDate,
      type: input.type,
      reason: input.reason,
      // status defaults to PENDING in the schema.
    },
    include: EMPLOYEE_INCLUDE,
  });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.LEAVE_SUBMITTED,
    entityType: "LeaveRequest",
    entityId: row.id,
    metadata: { startDate: input.startDate, endDate: input.endDate, type: input.type },
  });

  return toLeaveRequestDto(row);
}

/** Approver intent: PENDING → APPROVED | REJECTED. */
export type DecideLeaveInput = {
  decision: "APPROVED" | "REJECTED";
  decisionReason?: string;
};

export async function decideLeaveRequest(
  actor: LeaveActor,
  id: string,
  input: DecideLeaveInput,
): Promise<LeaveRequestDto> {
  assert(actor, "approve");

  // Re-enforced here even though the route schema already rejects it: a
  // rejection must carry the reason the employee will read, so no caller
  // path (seed, test, future route) can produce a silent rejection.
  if (input.decision === "REJECTED" && !input.decisionReason?.trim()) {
    throw errors.validation("A reason is required when rejecting a leave request.");
  }

  const existing = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!existing) throw errors.notFound("Leave request not found.");

  // HARD RULE 3: nobody decides their own request — not even an HR/ADMIN
  // user who is the subject of it. Runs BEFORE the state transition.
  if (actor.employeeId !== null && actor.employeeId === existing.employeeId) {
    throw errors.forbidden("You cannot decide your own leave request.");
  }

  // State machine: only PENDING can move to APPROVED/REJECTED.
  if (existing.status !== "PENDING") {
    throw errors.conflict(
      `This leave request is ${existing.status}; only PENDING requests can be decided.`,
    );
  }

  const row = await prisma.leaveRequest.update({
    where: { id },
    data: {
      status: input.decision,
      decisionReason: input.decisionReason ?? null,
      decidedById: actor.id,
      decidedAt: new Date(),
    },
    include: EMPLOYEE_INCLUDE,
  });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.LEAVE_DECIDED,
    entityType: "LeaveRequest",
    entityId: id,
    metadata: { decision: input.decision, previousStatus: "PENDING" },
  });

  return toLeaveRequestDto(row);
}

/** Owner intent: PENDING → CANCELLED, strictly by the owning employee. */
export async function cancelLeaveRequest(
  actor: LeaveActor,
  id: string,
): Promise<LeaveRequestDto> {
  assert(actor, "update");

  const existing = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!existing) throw errors.notFound("Leave request not found.");

  // Ownership first: cancellation is the owner's right, nobody else's.
  if (actor.employeeId === null || actor.employeeId !== existing.employeeId) {
    throw errors.forbidden("Only the employee who submitted a leave request can cancel it.");
  }

  // State machine: only PENDING can be cancelled.
  if (existing.status !== "PENDING") {
    throw errors.conflict(
      `This leave request is ${existing.status}; only PENDING requests can be cancelled.`,
    );
  }

  const row = await prisma.leaveRequest.update({
    where: { id },
    data: { status: "CANCELLED", cancelledAt: new Date() },
    include: EMPLOYEE_INCLUDE,
  });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.LEAVE_CANCELLED,
    entityType: "LeaveRequest",
    entityId: id,
    metadata: { previousStatus: existing.status },
  });

  return toLeaveRequestDto(row);
}
