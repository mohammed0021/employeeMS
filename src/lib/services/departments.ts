/**
 * Department service — RBAC + business rules + audit live here, not in the
 * route handler. PERMISSIONS.md: enforcement happens "in services, not just
 * this matrix", so every entry point (API, seed, future server action) is
 * covered even if a caller forgets its `requirePermission()` check.
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { errors } from "@/lib/errors";
import { can } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit/audit";
import { paginated, type ListQuery } from "@/lib/pagination";
import { toDepartmentDto, type DepartmentDto } from "@/lib/dto";
import type { Actor } from "@/lib/services/actor";
import type {
  CreateDepartmentInput,
  UpdateDepartmentInput,
} from "@/lib/validation/departments";

function assert(actor: Actor, action: "create" | "read" | "update" | "delete") {
  if (!can(actor.role, "departments", action)) throw errors.forbidden();
}

/** Map Prisma's unique-constraint error to a clean 409 (never leak SQL). */
function rethrowAsConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw errors.conflict("A department with that name already exists.");
  }
  throw error;
}

export async function listDepartments(query: ListQuery, actor: Actor): Promise<{
  items: DepartmentDto[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}> {
  assert(actor, "read");

  const where: Prisma.DepartmentWhereInput = query.q
    ? {
        OR: [
          { name: { contains: query.q, mode: "insensitive" } },
          { description: { contains: query.q, mode: "insensitive" } },
        ],
      }
    : {};

  const [rows, total] = await Promise.all([
    prisma.department.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: { _count: { select: { employees: true } } },
    }),
    prisma.department.count({ where }),
  ]);

  return paginated(rows.map(toDepartmentDto), total, query);
}

export async function getDepartment(id: string, actor: Actor): Promise<DepartmentDto> {
  assert(actor, "read");
  const row = await prisma.department.findUnique({
    where: { id },
    include: { _count: { select: { employees: true } } },
  });
  if (!row) throw errors.notFound("Department not found.");
  return toDepartmentDto(row);
}

export async function createDepartment(
  actor: Actor,
  input: CreateDepartmentInput,
): Promise<DepartmentDto> {
  assert(actor, "create");

  let row;
  try {
    row = await prisma.department.create({
      data: {
        name: input.name,
        description: input.description ?? null,
      },
      include: { _count: { select: { employees: true } } },
    });
  } catch (error) {
    rethrowAsConflict(error);
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.DEPARTMENT_CREATED,
    entityType: "Department",
    entityId: row.id,
    metadata: { name: row.name },
  });

  return toDepartmentDto(row);
}

export async function updateDepartment(
  actor: Actor,
  id: string,
  input: UpdateDepartmentInput,
): Promise<DepartmentDto> {
  assert(actor, "update");

  const existing = await prisma.department.findUnique({ where: { id } });
  if (!existing) throw errors.notFound("Department not found.");

  let row;
  try {
    row = await prisma.department.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
      },
      include: { _count: { select: { employees: true } } },
    });
  } catch (error) {
    rethrowAsConflict(error);
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.DEPARTMENT_UPDATED,
    entityType: "Department",
    entityId: id,
    metadata: { name: row.name },
  });

  return toDepartmentDto(row);
}

/**
 * Deletion is blocked while the department still has employees: the schema
 * has no `ON DELETE SET NULL` on `Employee.departmentId`, so a hard delete
 * would fail anyway — surfacing a clear 409 beats a raw FK error, and matches
 * PERMISSIONS.md's "reassign employees first" guidance.
 */
export async function deleteDepartment(actor: Actor, id: string): Promise<void> {
  assert(actor, "delete");

  const existing = await prisma.department.findUnique({
    where: { id },
    include: { _count: { select: { employees: true } } },
  });
  if (!existing) throw errors.notFound("Department not found.");

  const employeeCount = existing._count.employees;
  if (employeeCount > 0) {
    throw errors.conflict(
      `Cannot delete a department that still has ${employeeCount} employee(s). Reassign them first.`,
    );
  }

  await prisma.department.delete({ where: { id } });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.DEPARTMENT_DELETED,
    entityType: "Department",
    entityId: id,
    metadata: { name: existing.name },
  });
}
