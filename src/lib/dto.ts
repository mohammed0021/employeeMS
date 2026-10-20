/**
 * Data-transfer mappers — the single boundary between Prisma rows and JSON.
 *
 * PERMISSIONS.md hard rule 4: "Employees may only read resources scoped to
 * their own employeeId; DTO mappers strip salaries and other employees' data
 * from responses." Every route handler and server component serializes through
 * these functions so a raw Prisma row (with `salary`, `passwordHash`, …) can
 * never reach the client by accident.
 *
 * Dates go out as ISO strings and Decimals as exact strings: JSON has no
 * native Decimal, and `Number` would silently round money.
 */
import type { Role } from "@/lib/auth/permissions";

/** Who is asking — drives field-level redaction. */
export type Viewer = {
  role: Role;
  /** The caller's linked employee record, if any (drives `readOwn` scoping). */
  employeeId: string | null;
};

/**
 * Salary is visible to ADMIN/HR only.
 *
 * EMPLOYEE compensation is exposed solely through payslips (payroll
 * `readOwn`), never through the employee record. This keeps the strictest
 * reasonable default: if a mapper is ever wired to the wrong viewer, the
 * failure mode is "salary missing", not "salary leaked".
 */
export function canSeeSalary(role: Role): boolean {
  return role === "ADMIN" || role === "HR";
}

/**
 * Exact decimal string, guarding against float rounding.
 *
 * Prisma's `Decimal.toString()` normalizes trailing zeros away ("1000.10" →
 * "1000.1", "1000.00" → "1000"). Every column behind this mapper is a
 * `Decimal(12, 2)` money column and the UI renders the string verbatim
 * (payslips, CSV export), so restore the 2dp money scale here — string
 * arithmetic only, no `Number` ever touches an amount.
 */
export function money(value: { toString(): string } | null | undefined): string | null {
  if (value == null) return null;
  const text = value.toString();
  if (!text.includes(".")) return `${text}.00`;
  const [whole, fraction = ""] = text.split(".");
  return fraction.length >= 2 ? text : `${whole}.${fraction.padEnd(2, "0")}`;
}

export type EmployeeStatus = "ACTIVE" | "INACTIVE" | "ON_LEAVE";

export type EmployeeDto = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string | null;
  position: string;
  joinDate: string;
  status: EmployeeStatus;
  /** Only populated when `viewer.role` may see compensation. */
  salary: string | null;
  department: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

type EmployeeRow = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  position: string;
  joinDate: Date;
  salary: { toString(): string };
  status: EmployeeStatus;
  createdAt: Date;
  updatedAt: Date;
  department?: { id: string; name: string } | null;
};

export function toEmployeeDto(row: EmployeeRow, viewer: Viewer): EmployeeDto {
  return {
    id: row.id,
    employeeCode: row.employeeCode,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: `${row.firstName} ${row.lastName}`.trim(),
    email: row.email,
    phone: row.phone,
    position: row.position,
    joinDate: row.joinDate.toISOString().slice(0, 10),
    status: row.status,
    salary: canSeeSalary(viewer.role) ? money(row.salary) : null,
    department: row.department ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type DepartmentDto = {
  id: string;
  name: string;
  description: string | null;
  employeeCount: number;
  createdAt: string;
  updatedAt: string;
};

type DepartmentRow = {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  employees?: Array<{ id: string }>;
  _count?: { employees: number };
};

export function toDepartmentDto(row: DepartmentRow): DepartmentDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    employeeCount: row._count?.employees ?? row.employees?.length ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Compact employee reference embedded in attendance/leave/payroll rows. */
export type EmployeeRef = {
  id: string;
  employeeCode: string;
  fullName: string;
  position: string;
  department: { id: string; name: string } | null;
};

type EmployeeRefRow = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  position: string;
  department?: { id: string; name: string } | null;
};

export function toEmployeeRef(row: EmployeeRefRow): EmployeeRef {
  return {
    id: row.id,
    employeeCode: row.employeeCode,
    fullName: `${row.firstName} ${row.lastName}`.trim(),
    position: row.position,
    department: row.department ?? null,
  };
}

// ─── Attendance ─────────────────────────────────────────────────────────────

export type AttendanceStatus = "PRESENT" | "ABSENT" | "HALF_DAY" | "REMOTE";

export type AttendanceDto = {
  id: string;
  employeeId: string;
  /** Calendar date as `YYYY-MM-DD` (the `@db.Date` column has no time). */
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  status: AttendanceStatus;
  note: string | null;
  recordedById: string | null;
  employee: EmployeeRef | null;
  createdAt: string;
  updatedAt: string;
};

type AttendanceRow = {
  id: string;
  employeeId: string;
  date: Date;
  checkIn: Date | null;
  checkOut: Date | null;
  status: AttendanceStatus;
  note: string | null;
  recordedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  employee?: EmployeeRefRow | null;
};

export function toAttendanceDto(row: AttendanceRow): AttendanceDto {
  return {
    id: row.id,
    employeeId: row.employeeId,
    date: row.date.toISOString().slice(0, 10),
    checkIn: row.checkIn?.toISOString() ?? null,
    checkOut: row.checkOut?.toISOString() ?? null,
    status: row.status,
    note: row.note,
    recordedById: row.recordedById,
    employee: row.employee ? toEmployeeRef(row.employee) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Leave ──────────────────────────────────────────────────────────────────

export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export type LeaveType = "ANNUAL" | "SICK" | "UNPAID" | "MATERNITY" | "PATERNITY" | "OTHER";

export type LeaveRequestDto = {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  /** Inclusive calendar days between start and end. */
  days: number;
  type: LeaveType;
  reason: string;
  status: LeaveStatus;
  decisionReason: string | null;
  decidedById: string | null;
  decidedAt: string | null;
  cancelledAt: string | null;
  submittedAt: string;
  employee: EmployeeRef | null;
  createdAt: string;
  updatedAt: string;
};

/** Inclusive day count between two `@db.Date` values (guards TZ drift). */
export function inclusiveDays(start: Date, end: Date): number {
  const ms = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) -
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  return Math.floor(ms / 86_400_000) + 1;
}

type LeaveRow = {
  id: string;
  employeeId: string;
  startDate: Date;
  endDate: Date;
  type: LeaveType;
  reason: string;
  status: LeaveStatus;
  decisionReason: string | null;
  decidedById: string | null;
  decidedAt: Date | null;
  cancelledAt: Date | null;
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  employee?: EmployeeRefRow | null;
};

export function toLeaveRequestDto(row: LeaveRow): LeaveRequestDto {
  return {
    id: row.id,
    employeeId: row.employeeId,
    startDate: row.startDate.toISOString().slice(0, 10),
    endDate: row.endDate.toISOString().slice(0, 10),
    days: inclusiveDays(row.startDate, row.endDate),
    type: row.type,
    reason: row.reason,
    status: row.status,
    decisionReason: row.decisionReason,
    decidedById: row.decidedById,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    submittedAt: row.submittedAt.toISOString(),
    employee: row.employee ? toEmployeeRef(row.employee) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Payroll ────────────────────────────────────────────────────────────────

export type PayrollStatus = "DRAFT" | "FINAL";

export type PayrollRecordDto = {
  id: string;
  employeeId: string;
  month: number;
  year: number;
  /** All money as exact decimal strings — never `number`. */
  baseSalary: string;
  bonus: string;
  deduction: string;
  grossPay: string;
  netPay: string;
  status: PayrollStatus;
  finalizedAt: string | null;
  employee: EmployeeRef | null;
  createdAt: string;
  updatedAt: string;
};

type PayrollRow = {
  id: string;
  employeeId: string;
  month: number;
  year: number;
  baseSalary: { toString(): string };
  bonus: { toString(): string };
  deduction: { toString(): string };
  grossPay: { toString(): string };
  netPay: { toString(): string };
  status: PayrollStatus;
  finalizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  employee?: EmployeeRefRow | null;
};

/**
 * Defence in depth on top of query scoping: amounts render only for roles
 * that may see compensation, or for the employee's own payslip. If a row ever
 * reaches the wrong viewer, the failure is a blank amount — not a leak.
 */
export function toPayrollDto(row: PayrollRow, viewer: Viewer): PayrollRecordDto {
  const allowed = canSeeSalary(viewer.role) || viewer.employeeId === row.employeeId;
  return {
    id: row.id,
    employeeId: row.employeeId,
    month: row.month,
    year: row.year,
    baseSalary: allowed ? money(row.baseSalary) ?? "0" : "0",
    bonus: allowed ? money(row.bonus) ?? "0" : "0",
    deduction: allowed ? money(row.deduction) ?? "0" : "0",
    grossPay: allowed ? money(row.grossPay) ?? "0" : "0",
    netPay: allowed ? money(row.netPay) ?? "0" : "0",
    status: row.status,
    finalizedAt: row.finalizedAt?.toISOString() ?? null,
    employee: row.employee ? toEmployeeRef(row.employee) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
