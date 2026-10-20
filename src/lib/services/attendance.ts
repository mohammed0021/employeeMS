/**
 * Attendance service — RBAC + business rules + audit live here, not in the
 * route handler (mirrors src/lib/services/departments.ts so every entry
 * point — API, seed, future server action — is covered even if a caller
 * forgets its `requirePermission()` check).
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { errors } from "@/lib/errors";
import { can } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit/audit";
import { paginated, type ListQuery } from "@/lib/pagination";
import { toAttendanceDto, type AttendanceDto } from "@/lib/dto";
import type { Actor, EmployeeScopeActor } from "@/lib/services/actor";
import {
  TIME_PATTERN,
  type AttendanceListFilters,
  type CorrectAttendanceInput,
  type RecordAttendanceInput,
} from "@/lib/validation/attendance";

/** Employee + department ref so `toAttendanceDto` gets its `EmployeeRef`. */
const EMPLOYEE_INCLUDE = {
  employee: { include: { department: { select: { id: true, name: true } } } },
} satisfies Prisma.AttendanceInclude;

type AttendanceSort = { field: string; dir: "asc" | "desc" };

/**
 * ADMIN/HR hold `read` (org-wide); EMPLOYEE holds only `readOwn` (their own
 * rows). Returns whether the caller's queries must be scoped to their own
 * employee record. HARD RULE 4 (PERMISSIONS.md): scoping happens here in the
 * service, never only in the UI.
 */
function assertRead(actor: Actor): boolean {
  if (can(actor.role, "attendance", "read")) return false;
  if (can(actor.role, "attendance", "readOwn")) return true;
  throw errors.forbidden();
}

/** Map Prisma's unique-constraint error to a clean 409 (never leak SQL). */
function rethrowAsConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw errors.conflict("Attendance is already recorded for this employee on that date.");
  }
  throw error;
}

/**
 * The `@db.Date` column is stored at UTC midnight: anchoring the parsed date
 * there (instead of server-local time) keeps the calendar date identical in
 * every time zone.
 */
function startOfUtcDay(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/**
 * Parse a check-in/out value: `HH:MM[:SS]` is a time of day anchored to the
 * record's calendar date (UTC); anything else is already a full ISO datetime.
 */
function toDateTime(value: string, baseDate: Date): Date {
  if (TIME_PATTERN.test(value)) {
    const time = value.length === 5 ? `${value}:00` : value;
    return new Date(`${baseDate.toISOString().slice(0, 10)}T${time}.000Z`);
  }
  return new Date(value);
}

function assertTimesOrdered(checkIn: Date | null, checkOut: Date | null): void {
  // `<=`, not `<`: a zero-duration day (check-out === check-in) is just as
  // meaningless as an out-before-in one, and the client's own refine rule
  // (src/components/attendance/attendance-actions.tsx) rejects equality too.
  if (checkIn && checkOut && checkOut.getTime() <= checkIn.getTime()) {
    throw errors.validation("Check-out must be after check-in.");
  }
}

/** Allow-list of sort columns — the raw query param is never used directly. */
function orderByFor(sort: AttendanceSort): Prisma.AttendanceOrderByWithRelationInput {
  switch (sort.field) {
    case "checkIn":
      return { checkIn: sort.dir };
    case "checkOut":
      return { checkOut: sort.dir };
    case "status":
      return { status: sort.dir };
    case "createdAt":
      return { createdAt: sort.dir };
    default:
      return { date: sort.dir };
  }
}

export async function listAttendance(
  query: ListQuery,
  filters: AttendanceListFilters,
  sort: AttendanceSort,
  actor: EmployeeScopeActor,
): Promise<{
  items: AttendanceDto[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}> {
  const scoped = assertRead(actor);

  const where: Prisma.AttendanceWhereInput = {};
  if (scoped) {
    // EMPLOYEE sees only their own history; no linked employee → empty page.
    if (!actor.employeeId) return paginated([], 0, query);
    where.employeeId = actor.employeeId;
  } else if (filters.employeeId) {
    where.employeeId = filters.employeeId;
  }

  if (filters.dateFrom || filters.dateTo) {
    // Inclusive bounds on the calendar `date` column.
    where.date = {
      ...(filters.dateFrom ? { gte: startOfUtcDay(filters.dateFrom) } : {}),
      ...(filters.dateTo ? { lte: startOfUtcDay(filters.dateTo) } : {}),
    };
  }
  if (filters.status) where.status = filters.status;
  if (query.q) {
    where.OR = [
      { note: { contains: query.q, mode: "insensitive" } },
      { employee: { firstName: { contains: query.q, mode: "insensitive" } } },
      { employee: { lastName: { contains: query.q, mode: "insensitive" } } },
      { employee: { employeeCode: { contains: query.q, mode: "insensitive" } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.attendance.findMany({
      where,
      orderBy: orderByFor(sort),
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: EMPLOYEE_INCLUDE,
    }),
    prisma.attendance.count({ where }),
  ]);

  return paginated(rows.map(toAttendanceDto), total, query);
}

export async function getAttendance(
  id: string,
  actor: EmployeeScopeActor,
): Promise<AttendanceDto> {
  const scoped = assertRead(actor);
  const row = await prisma.attendance.findUnique({
    where: { id },
    include: EMPLOYEE_INCLUDE,
  });
  if (!row) throw errors.notFound("Attendance record not found.");
  // EMPLOYEE may only read their own row; a caller with no linked employee
  // can never match, so they get 403 rather than someone else's record.
  if (scoped && row.employeeId !== actor.employeeId) throw errors.forbidden();
  return toAttendanceDto(row);
}

export async function recordAttendance(
  actor: Actor,
  input: RecordAttendanceInput,
): Promise<AttendanceDto> {
  if (!can(actor.role, "attendance", "create")) throw errors.forbidden();

  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true },
  });
  if (!employee) throw errors.notFound("Employee not found.");

  const date = startOfUtcDay(input.date);
  const checkIn = input.checkIn !== undefined ? toDateTime(input.checkIn, date) : null;
  const checkOut = input.checkOut !== undefined ? toDateTime(input.checkOut, date) : null;
  assertTimesOrdered(checkIn, checkOut);

  let row;
  try {
    row = await prisma.attendance.create({
      data: {
        employeeId: input.employeeId,
        date,
        status: input.status,
        checkIn,
        checkOut,
        note: input.note ?? null,
        recordedById: actor.id,
      },
      include: EMPLOYEE_INCLUDE,
    });
  } catch (error) {
    // @@unique([employeeId, date]) — duplicates become a clean 409.
    rethrowAsConflict(error);
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.ATTENDANCE_RECORDED,
    entityType: "Attendance",
    entityId: row.id,
    metadata: { employeeId: row.employeeId, date: input.date, status: row.status },
  });

  return toAttendanceDto(row);
}

/** Correct an existing record (ADMIN/HR "update"). */
export async function correctAttendance(
  actor: Actor,
  id: string,
  input: CorrectAttendanceInput,
): Promise<AttendanceDto> {
  if (!can(actor.role, "attendance", "update")) throw errors.forbidden();

  const existing = await prisma.attendance.findUnique({ where: { id } });
  if (!existing) throw errors.notFound("Attendance record not found.");

  if (input.employeeId !== undefined && input.employeeId !== existing.employeeId) {
    const employee = await prisma.employee.findUnique({
      where: { id: input.employeeId },
      select: { id: true },
    });
    if (!employee) throw errors.notFound("Employee not found.");
  }

  // Effective values = existing row + corrections; times/note may be cleared.
  const date = input.date !== undefined ? startOfUtcDay(input.date) : existing.date;
  const checkIn =
    input.checkIn !== undefined
      ? input.checkIn === null
        ? null
        : toDateTime(input.checkIn, date)
      : existing.checkIn;
  const checkOut =
    input.checkOut !== undefined
      ? input.checkOut === null
        ? null
        : toDateTime(input.checkOut, date)
      : existing.checkOut;
  assertTimesOrdered(checkIn, checkOut);

  let row;
  try {
    row = await prisma.attendance.update({
      where: { id },
      data: {
        employeeId: input.employeeId ?? existing.employeeId,
        date,
        status: input.status ?? existing.status,
        checkIn,
        checkOut,
        note: input.note !== undefined ? input.note : existing.note,
      },
      include: EMPLOYEE_INCLUDE,
    });
  } catch (error) {
    // Re-pointing date/employeeId at another row's pair still trips
    // @@unique([employeeId, date]) — surface it as a 409, not raw SQL.
    rethrowAsConflict(error);
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.ATTENDANCE_CORRECTED,
    entityType: "Attendance",
    entityId: row.id,
    metadata: {
      employeeId: row.employeeId,
      date: row.date.toISOString().slice(0, 10),
      status: row.status,
    },
  });

  return toAttendanceDto(row);
}
