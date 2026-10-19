/**
 * Payroll service — RBAC, exact money math, the DRAFT→FINAL state machine and
 * audit live here, not in the route handler. PERMISSIONS.md: enforcement
 * happens "in services, not just this matrix", so every entry point (API,
 * seed, future server action) is covered even if a caller forgets its
 * `requirePermission()` check.
 *
 * MONEY IS EXACT: every calculation uses Prisma's `Decimal` (base-10, exact)
 * — `grossPay = baseSalary.plus(bonus)`, `netPay = grossPay.minus(deduction)`.
 * No `number` arithmetic touches an amount anywhere in this module.
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError, errors } from "@/lib/errors";
import { can, type Action } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guards";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit/audit";
import { offset, paginated, type ListQuery } from "@/lib/pagination";
import { toPayrollDto, type PayrollRecordDto, type Viewer } from "@/lib/dto";
import { actorFrom, type Actor } from "@/lib/services/actor";
import type { Session } from "@/lib/auth/session";
import type {
  CreatePayrollInput,
  ModifyPayrollInput,
  PayrollFilters,
} from "@/lib/validation/payroll";

// ─── Actor & guards ──────────────────────────────────────────────────────────

/**
 * The shared `Actor` plus the session's linked employee: EMPLOYEE rows are
 * scoped to `employeeId` (PERMISSIONS.md hard rule 4), and the DTO viewer needs
 * the same id to decide whether amounts are rendered at all.
 */
export type PayrollActor = Actor & { employeeId: string | null };

export function payrollActorFrom(session: Session): PayrollActor {
  return { ...actorFrom(session), employeeId: session.user.employeeId };
}

/**
 * Route-level read gate: ADMIN/HR hold `read`, EMPLOYEE holds `readOwn`.
 * The shared guard exposes one action per call, so a 403 from the org-wide
 * action is retried with the self-scoped one — row-level scoping is still
 * enforced below (queries + `getPayroll`). Routes stay thin: they call this
 * instead of widening the permission matrix.
 */
export async function requirePayrollRead(): Promise<Session> {
  try {
    return await requirePermission("payroll", "read");
  } catch (error) {
    if (error instanceof AppError && error.status === 403) {
      return await requirePermission("payroll", "readOwn");
    }
    throw error;
  }
}

function assert(actor: PayrollActor, action: Action) {
  if (!can(actor.role, "payroll", action)) throw errors.forbidden();
}

/** true → org-wide read (ADMIN/HR); false → self-scoped readOwn (EMPLOYEE). */
function canReadAll(actor: PayrollActor): boolean {
  if (can(actor.role, "payroll", "read")) return true;
  if (can(actor.role, "payroll", "readOwn")) return false;
  throw errors.forbidden();
}

// ─── Shared query fragments ──────────────────────────────────────────────────

const EMPLOYEE_INCLUDE = {
  employee: {
    include: { department: { select: { id: true, name: true } } },
  },
} satisfies Prisma.PayrollRecordInclude;

/** Sort allow-list — `resolveSort` can only ever return one of these names. */
export const PAYROLL_SORT_FIELDS: ReadonlySet<string> = new Set([
  "year",
  "month",
  "netPay",
  "status",
  "createdAt",
]);

function viewerOf(actor: PayrollActor): Viewer {
  return { role: actor.role, employeeId: actor.employeeId };
}

/** Map the allow-listed sort field to a typed orderBy (never interpolate). */
function orderByFor(sort: {
  field: string;
  dir: "asc" | "desc";
}): Prisma.PayrollRecordOrderByWithRelationInput {
  switch (sort.field) {
    case "year":
      return { year: sort.dir };
    case "month":
      return { month: sort.dir };
    case "netPay":
      return { netPay: sort.dir };
    case "status":
      return { status: sort.dir };
    default:
      return { createdAt: sort.dir };
  }
}

/**
 * Shared WHERE builder for list + export.
 *
 * `ownEmployeeId` present → self-scoped caller: the employeeId filter is
 * forced to their own record, so a foreign `?employeeId=` can never widen the
 * scope. Absent → org-wide caller: the employeeId filter applies as given.
 */
function buildWhere(filters: PayrollFilters, ownEmployeeId?: string): Prisma.PayrollRecordWhereInput {
  const where: Prisma.PayrollRecordWhereInput = {};
  if (filters.month !== undefined) where.month = filters.month;
  if (filters.year !== undefined) where.year = filters.year;
  if (filters.status !== undefined) where.status = filters.status;
  if (ownEmployeeId !== undefined) where.employeeId = ownEmployeeId;
  else if (filters.employeeId !== undefined) where.employeeId = filters.employeeId;
  return where;
}

// ─── Exact money math ────────────────────────────────────────────────────────

/** Column ceiling: `Decimal(12, 2)` = 10 integer digits + 2 fractional digits. */
const MAX_AMOUNT = new Prisma.Decimal("9999999999.99");

/**
 * The ONLY money arithmetic in the payroll module — all on Prisma's `Decimal`
 * (exact, base-10):
 *   grossPay = baseSalary.plus(bonus)
 *   netPay   = grossPay.minus(deduction)
 * Business rules (base > 0, bonus >= 0, deduction >= 0, net >= 0) throw 400
 * before anything is written.
 */
function settleMoney(
  baseSalary: Prisma.Decimal,
  bonus: Prisma.Decimal,
  deduction: Prisma.Decimal,
): {
  baseSalary: Prisma.Decimal;
  bonus: Prisma.Decimal;
  deduction: Prisma.Decimal;
  grossPay: Prisma.Decimal;
  netPay: Prisma.Decimal;
} {
  if (!baseSalary.greaterThan(0)) {
    throw errors.validation("Base salary must be greater than zero.");
  }
  if (bonus.isNegative()) throw errors.validation("Bonus cannot be negative.");
  if (deduction.isNegative()) throw errors.validation("Deduction cannot be negative.");

  const grossPay = baseSalary.plus(bonus);
  if (grossPay.greaterThan(MAX_AMOUNT)) {
    throw errors.validation("Gross pay exceeds the maximum storable amount.");
  }

  const netPay = grossPay.minus(deduction);
  if (netPay.isNegative()) throw errors.validation("Net pay cannot be negative.");

  return { baseSalary, bonus, deduction, grossPay, netPay };
}

/** Map Prisma's unique-constraint error to a clean 409 (never leak SQL). */
function rethrowAsConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw errors.conflict("A payroll record already exists for that employee and period.");
  }
  throw error;
}

// ─── Read ────────────────────────────────────────────────────────────────────

export type PayrollListResult = {
  items: PayrollRecordDto[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
};

export async function listPayrolls(
  query: ListQuery,
  filters: PayrollFilters,
  sort: { field: string; dir: "asc" | "desc" },
  actor: PayrollActor,
): Promise<PayrollListResult> {
  const orgWide = canReadAll(actor);

  // readOwn with no linked employee → no payslips can exist.
  if (!orgWide && actor.employeeId === null) {
    return paginated<PayrollRecordDto>([], 0, query);
  }

  // `undefined` → org-wide scope; a string → forced own-employee scope.
  const ownEmployeeId = orgWide ? undefined : (actor.employeeId ?? undefined);
  const where = buildWhere(filters, ownEmployeeId);
  const [rows, total] = await Promise.all([
    prisma.payrollRecord.findMany({
      where,
      orderBy: orderByFor(sort),
      skip: offset(query),
      take: query.limit,
      include: EMPLOYEE_INCLUDE,
    }),
    prisma.payrollRecord.count({ where }),
  ]);

  const viewer = viewerOf(actor);
  return paginated(rows.map((row) => toPayrollDto(row, viewer)), total, query);
}

export async function getPayroll(id: string, actor: PayrollActor): Promise<PayrollRecordDto> {
  const orgWide = canReadAll(actor);

  const row = await prisma.payrollRecord.findUnique({
    where: { id },
    include: EMPLOYEE_INCLUDE,
  });
  if (!row) throw errors.notFound("Payroll record not found.");

  // EMPLOYEE may only read their own payslips (PERMISSIONS.md hard rule 4).
  if (!orgWide && (actor.employeeId === null || row.employeeId !== actor.employeeId)) {
    throw errors.forbidden();
  }

  return toPayrollDto(row, viewerOf(actor));
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createPayroll(
  actor: PayrollActor,
  input: CreatePayrollInput,
): Promise<PayrollRecordDto> {
  assert(actor, "create");

  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true },
  });
  if (!employee) throw errors.notFound("Employee not found.");

  const money = settleMoney(
    new Prisma.Decimal(input.baseSalary),
    new Prisma.Decimal(input.bonus ?? "0"),
    new Prisma.Decimal(input.deduction ?? "0"),
  );

  let row;
  try {
    row = await prisma.payrollRecord.create({
      data: {
        employeeId: input.employeeId,
        month: input.month,
        year: input.year,
        baseSalary: money.baseSalary,
        bonus: money.bonus,
        deduction: money.deduction,
        grossPay: money.grossPay,
        netPay: money.netPay,
        status: "DRAFT",
        createdById: actor.id,
      },
      include: EMPLOYEE_INCLUDE,
    });
  } catch (error) {
    // @@unique([employeeId, month, year]) → duplicate period is a clean 409.
    rethrowAsConflict(error);
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.PAYROLL_GENERATED,
    entityType: "PayrollRecord",
    entityId: row.id,
    metadata: { employeeId: row.employeeId, month: row.month, year: row.year },
  });

  return toPayrollDto(row, viewerOf(actor));
}

// ─── Modify / finalize ───────────────────────────────────────────────────────

/**
 * PATCH /api/payroll/:id — two intents, both requiring "update" (ADMIN/HR):
 *  - `update`   : bonus/deduction/baseSalary edits while DRAFT; FINAL is
 *                 immutable and rejected BEFORE any write.
 *  - `finalize` : DRAFT → FINAL, stamped with the finalizing actor.
 */
export async function modifyPayroll(
  actor: PayrollActor,
  id: string,
  input: ModifyPayrollInput,
): Promise<PayrollRecordDto> {
  assert(actor, "update");
  return input.intent === "update"
    ? applyUpdate(actor, id, input.update)
    : applyFinalize(actor, id);
}

async function loadForWrite(id: string) {
  const existing = await prisma.payrollRecord.findUnique({ where: { id } });
  if (!existing) throw errors.notFound("Payroll record not found.");
  return existing;
}

async function applyUpdate(
  actor: PayrollActor,
  id: string,
  patch: { baseSalary?: string; bonus?: string; deduction?: string },
): Promise<PayrollRecordDto> {
  const existing = await loadForWrite(id);

  // Immutability is decided BEFORE any write …
  if (existing.status === "FINAL") {
    throw errors.conflict("Finalized payroll records are immutable.");
  }

  const money = settleMoney(
    patch.baseSalary !== undefined
      ? new Prisma.Decimal(patch.baseSalary)
      : existing.baseSalary,
    patch.bonus !== undefined ? new Prisma.Decimal(patch.bonus) : existing.bonus,
    patch.deduction !== undefined
      ? new Prisma.Decimal(patch.deduction)
      : existing.deduction,
  );

  // … and re-checked atomically in the write itself, so a concurrent finalize
  // cannot slip an edit into a FINAL row.
  const result = await prisma.payrollRecord.updateMany({
    where: { id, status: "DRAFT" },
    data: {
      baseSalary: money.baseSalary,
      bonus: money.bonus,
      deduction: money.deduction,
      grossPay: money.grossPay,
      netPay: money.netPay,
    },
  });
  if (result.count === 0) {
    throw errors.conflict("Finalized payroll records are immutable.");
  }

  const row = await prisma.payrollRecord.findUniqueOrThrow({
    where: { id },
    include: EMPLOYEE_INCLUDE,
  });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.PAYROLL_MODIFIED,
    entityType: "PayrollRecord",
    entityId: row.id,
    metadata: { employeeId: row.employeeId, month: row.month, year: row.year },
  });

  return toPayrollDto(row, viewerOf(actor));
}

async function applyFinalize(actor: PayrollActor, id: string): Promise<PayrollRecordDto> {
  const existing = await loadForWrite(id);

  if (existing.status !== "DRAFT") {
    throw errors.conflict("Only draft payroll records can be finalized.");
  }

  const finalizedAt = new Date();
  const result = await prisma.payrollRecord.updateMany({
    where: { id, status: "DRAFT" },
    data: { status: "FINAL", finalizedById: actor.id, finalizedAt },
  });
  if (result.count === 0) {
    throw errors.conflict("Only draft payroll records can be finalized.");
  }

  const row = await prisma.payrollRecord.findUniqueOrThrow({
    where: { id },
    include: EMPLOYEE_INCLUDE,
  });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.PAYROLL_FINALIZED,
    entityType: "PayrollRecord",
    entityId: row.id,
    metadata: { employeeId: row.employeeId, month: row.month, year: row.year },
  });

  return toPayrollDto(row, viewerOf(actor));
}

// ─── CSV export ──────────────────────────────────────────────────────────────

const CSV_COLUMNS = [
  "year",
  "month",
  "employeeCode",
  "employeeName",
  "baseSalary",
  "bonus",
  "deduction",
  "grossPay",
  "netPay",
  "status",
] as const;

/** RFC 4180 quoting — names/codes may contain commas or quotes. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Full (unpaginated) CSV of every record matching the same filters as the list
 * endpoint. Amounts are taken from the DTO as exact decimal strings — a float
 * never touches them. Requires "export" (ADMIN/HR).
 */
export async function exportPayrolls(
  actor: PayrollActor,
  filters: PayrollFilters,
): Promise<string> {
  assert(actor, "export");

  const rows = await prisma.payrollRecord.findMany({
    where: buildWhere(filters),
    orderBy: [{ year: "desc" }, { month: "desc" }, { employeeId: "asc" }],
    include: EMPLOYEE_INCLUDE,
  });

  const viewer = viewerOf(actor);
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    const dto = toPayrollDto(row, viewer);
    lines.push(
      [
        String(dto.year),
        String(dto.month),
        dto.employee?.employeeCode ?? "",
        dto.employee?.fullName ?? "",
        dto.baseSalary,
        dto.bonus,
        dto.deduction,
        dto.grossPay,
        dto.netPay,
        dto.status,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  return lines.join("\r\n");
}
