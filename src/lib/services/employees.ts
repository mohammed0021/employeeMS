/**
 * Employee service — RBAC + business rules + audit live here, not in the
 * route handler (same contract as services/departments.ts: PERMISSIONS.md
 * says enforcement happens "in services, not just this matrix", so every
 * entry point — API, seed, future server action — is covered even if a
 * caller forgets its route-level check).
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { errors } from "@/lib/errors";
import { can, type Action } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit/audit";
import { paginated, type ListQuery } from "@/lib/pagination";
import { canSeeSalary, toEmployeeDto, type EmployeeDto, type Viewer } from "@/lib/dto";
import { employeeScopeFrom, type EmployeeScopeActor } from "@/lib/services/actor";
import type {
  CreateEmployeeInput,
  EmployeeFilters,
  UpdateEmployeeInput,
} from "@/lib/validation/employees";

/**
 * `EmployeeActor` is the shared employee-scoped actor: `readOwn` scoping (list
 * and single read) and DTO viewing both need to know *which* employee the
 * caller is. See src/lib/services/actor.ts — single-sourced there because four
 * copies of "derive the caller's employee id" is how one of them ends up
 * trusting a request body instead of the session.
 */
export type EmployeeActor = EmployeeScopeActor;

export const employeeActorFrom = employeeScopeFrom;

function viewerOf(actor: EmployeeActor): Viewer {
  return { role: actor.role, employeeId: actor.employeeId };
}

/** Matrix check for `resource: "employees"` — mirrors departments' assert(). */
function assert(actor: EmployeeActor, action: Action): void {
  if (!can(actor.role, "employees", action)) throw errors.forbidden();
}

/**
 * `read` (ADMIN/HR: any employee) OR `readOwn` (EMPLOYEE: own record only).
 * A naive `assert(actor, "read")` would lock EMPLOYEE out of their own
 * profile, because they only ever hold `readOwn`.
 */
function assertReadable(actor: EmployeeActor): void {
  if (!can(actor.role, "employees", "read") && !can(actor.role, "employees", "readOwn")) {
    throw errors.forbidden();
  }
}

/** Map Prisma's unique-constraint error to a clean 409 (never leak SQL). */
function rethrowAsConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw errors.conflict("An employee with that code or email already exists.");
  }
  throw error;
}

/** departmentId is a FK — fail with a clear message before Prisma does. */
async function assertDepartmentExists(id: string): Promise<void> {
  const department = await prisma.department.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!department) throw errors.notFound("Department not found.");
}

const DEPARTMENT_INCLUDE = { department: { select: { id: true, name: true } } };

/** Shared q/departmentId/status filters for list + export. */
function buildWhere(filters: EmployeeFilters): Prisma.EmployeeWhereInput {
  const where: Prisma.EmployeeWhereInput = {};
  if (filters.departmentId) where.departmentId = filters.departmentId;
  if (filters.status) where.status = filters.status;
  if (filters.q) {
    where.OR = [
      { firstName: { contains: filters.q, mode: "insensitive" } },
      { lastName: { contains: filters.q, mode: "insensitive" } },
      { email: { contains: filters.q, mode: "insensitive" } },
      { employeeCode: { contains: filters.q, mode: "insensitive" } },
      { position: { contains: filters.q, mode: "insensitive" } },
    ];
  }
  return where;
}

export type EmployeeSort = { field: string; dir: "asc" | "desc" };

/**
 * Maps the already allow-listed sort field (resolveSort in the route) to a
 * typed orderBy clause — the raw query param itself never reaches Prisma,
 * and the switch's default keeps unknown values on `lastName`.
 */
function orderByFor(sort: EmployeeSort): Prisma.EmployeeOrderByWithRelationInput[] {
  const primary: Prisma.EmployeeOrderByWithRelationInput =
    sort.field === "firstName"
      ? { firstName: sort.dir }
      : sort.field === "joinDate"
        ? { joinDate: sort.dir }
        : sort.field === "employeeCode"
          ? { employeeCode: sort.dir }
          : sort.field === "salary"
            ? { salary: sort.dir }
            : sort.field === "createdAt"
              ? { createdAt: sort.dir }
              : { lastName: sort.dir };
  // Stable tie-break so equal sort keys never shuffle between pages.
  return [primary, { id: "asc" }];
}

export type EmployeePage = {
  items: EmployeeDto[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
};

export async function listEmployees(
  query: ListQuery,
  filters: EmployeeFilters,
  sort: EmployeeSort,
  actor: EmployeeActor,
): Promise<EmployeePage> {
  assertReadable(actor);
  const viewer = viewerOf(actor);
  const where = buildWhere(filters);

  if (!can(actor.role, "employees", "read")) {
    // EMPLOYEE: scoped to their own record. No linked record → empty page
    // (not an error) — they simply have no profile row yet.
    if (!actor.employeeId) return paginated([], 0, query);
    where.id = actor.employeeId;
  }

  const [rows, total] = await Promise.all([
    prisma.employee.findMany({
      where,
      orderBy: orderByFor(sort),
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: DEPARTMENT_INCLUDE,
    }),
    prisma.employee.count({ where }),
  ]);

  return paginated(
    rows.map((row) => toEmployeeDto(row, viewer)),
    total,
    query,
  );
}

export async function getEmployee(id: string, actor: EmployeeActor): Promise<EmployeeDto> {
  assertReadable(actor);

  // readOwn: only the caller's own record — anyone else's id is a 403,
  // even before we learn whether that record exists.
  if (!can(actor.role, "employees", "read") && actor.employeeId !== id) {
    throw errors.forbidden();
  }

  const row = await prisma.employee.findUnique({
    where: { id },
    include: DEPARTMENT_INCLUDE,
  });
  if (!row) throw errors.notFound("Employee not found.");
  return toEmployeeDto(row, viewerOf(actor));
}

export async function createEmployee(
  actor: EmployeeActor,
  input: CreateEmployeeInput,
): Promise<EmployeeDto> {
  assert(actor, "create");
  await assertDepartmentExists(input.departmentId);

  let row;
  try {
    row = await prisma.employee.create({
      data: {
        employeeCode: input.employeeCode,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone ?? null,
        position: input.position,
        joinDate: input.joinDate,
        // Exact decimal string — a JSON float never rounds money.
        salary: String(input.salary),
        status: input.status ?? "ACTIVE",
        departmentId: input.departmentId,
        createdById: actor.id,
      },
      include: DEPARTMENT_INCLUDE,
    });
  } catch (error) {
    rethrowAsConflict(error);
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.EMPLOYEE_CREATED,
    entityType: "Employee",
    entityId: row.id,
    metadata: { employeeCode: row.employeeCode, departmentId: row.departmentId },
  });

  return toEmployeeDto(row, viewerOf(actor));
}

export async function updateEmployee(
  actor: EmployeeActor,
  id: string,
  input: UpdateEmployeeInput,
): Promise<EmployeeDto> {
  assert(actor, "update");

  const existing = await prisma.employee.findUnique({ where: { id } });
  if (!existing) throw errors.notFound("Employee not found.");

  if (input.departmentId !== undefined) await assertDepartmentExists(input.departmentId);

  // Deactivation timestamp only on the ACTIVE/ON_LEAVE → INACTIVE transition,
  // so a repeat PATCH of an already-inactive employee keeps the original date.
  const becomingInactive = input.status === "INACTIVE" && existing.status !== "INACTIVE";

  let row;
  try {
    row = await prisma.employee.update({
      where: { id },
      data: {
        ...(input.employeeCode !== undefined ? { employeeCode: input.employeeCode } : {}),
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(input.joinDate !== undefined ? { joinDate: input.joinDate } : {}),
        ...(input.salary !== undefined ? { salary: String(input.salary) } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(becomingInactive ? { deactivatedAt: new Date() } : {}),
      },
      include: DEPARTMENT_INCLUDE,
    });
  } catch (error) {
    rethrowAsConflict(error);
  }

  // Field *names* only — audit metadata must never carry values like salary.
  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.EMPLOYEE_UPDATED,
    entityType: "Employee",
    entityId: id,
    metadata: { employeeCode: row.employeeCode, fields: Object.keys(input) },
  });

  if (becomingInactive) {
    await recordAudit({
      actor,
      action: AUDIT_ACTIONS.EMPLOYEE_DEACTIVATED,
      entityType: "Employee",
      entityId: id,
      metadata: { employeeCode: row.employeeCode },
    });
  }

  return toEmployeeDto(row, viewerOf(actor));
}

/**
 * Deletion is blocked while any historical row exists: every history FK is
 * `Restrict` in the schema, so a hard delete would fail anyway — surfacing a
 * clear 409 beats a raw FK error and matches the schema's rule ("deactivation,
 * not deletion"). The linked login account (`User.employeeId`) is `SetNull`
 * and attrition rows are `Cascade`, so these four counts cover everything
 * that could block the delete.
 */
export async function deleteEmployee(actor: EmployeeActor, id: string): Promise<void> {
  assert(actor, "delete");

  const existing = await prisma.employee.findUnique({
    where: { id },
    select: { id: true, employeeCode: true, departmentId: true },
  });
  if (!existing) throw errors.notFound("Employee not found.");

  const [attendances, leaveRequests, payrollRecords, feedback] = await Promise.all([
    prisma.attendance.count({ where: { employeeId: id } }),
    prisma.leaveRequest.count({ where: { employeeId: id } }),
    prisma.payrollRecord.count({ where: { employeeId: id } }),
    prisma.performanceFeedback.count({ where: { employeeId: id } }),
  ]);
  if (attendances > 0 || leaveRequests > 0 || payrollRecords > 0 || feedback > 0) {
    throw errors.conflict("This employee has historical records — deactivate them instead.");
  }

  await prisma.employee.delete({ where: { id } });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.EMPLOYEE_DELETED,
    entityType: "Employee",
    entityId: id,
    metadata: { employeeCode: existing.employeeCode, departmentId: existing.departmentId },
  });
}

const CSV_HEADER = [
  "employeeCode",
  "firstName",
  "lastName",
  "email",
  "position",
  "department",
  "joinDate",
  "salary",
  "status",
] as const;

/** RFC 4180 cell: quote when the value contains a delimiter, quote or newline. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Full CSV export (no pagination) honouring the same filters as the list.
 * Rows are serialized through `toEmployeeDto` first — the same redaction
 * boundary every JSON response uses — and the salary column is gated again
 * explicitly via `canSeeSalary`, so a DTO/viewer mix-up still cannot leak
 * compensation into the file.
 */
export async function exportEmployeesCsv(
  actor: EmployeeActor,
  filters: EmployeeFilters,
): Promise<string> {
  assert(actor, "export");

  const viewer = viewerOf(actor);
  const rows = await prisma.employee.findMany({
    where: buildWhere(filters),
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    include: DEPARTMENT_INCLUDE,
  });

  const showSalary = canSeeSalary(actor.role);
  const lines = [CSV_HEADER.join(",")];
  for (const dto of rows.map((row) => toEmployeeDto(row, viewer))) {
    lines.push(
      [
        dto.employeeCode,
        dto.firstName,
        dto.lastName,
        dto.email,
        dto.position,
        dto.department?.name ?? "",
        dto.joinDate,
        showSalary ? (dto.salary ?? "") : "",
        dto.status,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}
