/**
 * Reports service — every figure comes from a counted/aggregated query;
 * nothing here interpolates, estimates or fabricates a number.
 *
 * SCOPE (mirrors the permission matrix):
 *  - computeSummary  : ORG-WIDE read (ADMIN/HR, `reports.read`).
 *  - computeOwnSummary: self-scoped readOwn (EMPLOYEE) — row scoping to
 *                      `actor.employeeId` happens HERE (hard rule 4), never
 *                      only in the UI, and the id comes from the session.
 *  - exportCsv       : export action (ADMIN/HR only) — EMPLOYEE readOwn
 *                      never exports, so they get a 403 here.
 *
 * MONEY IS EXACT: totals reduce Prisma `Decimal`s with `.plus` and are
 * serialized via `money()` — a `number` never touches an amount (same rule
 * as services/payroll.ts).
 *
 * DATES: `@db.Date` columns (attendance.date) are compared at UTC midnight;
 * timestamps (`submittedAt`, `createdAt`) use an inclusive [from 00:00,
 * to+1d 00:00) window so "to" means the whole day.
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { errors } from "@/lib/errors";
import { can } from "@/lib/auth/permissions";
import { inclusiveDays, money } from "@/lib/dto";
import type { EmployeeScopeActor } from "@/lib/services/actor";
import type { ReportExportKind, ReportRange } from "@/lib/validation/reports";

// ─── Range resolution ────────────────────────────────────────────────────────

type ResolvedRange = {
  from: string;
  to: string;
  /** UTC-midnight anchor of `from` (matches `@db.Date` storage). */
  fromDate: Date;
  /** UTC-midnight anchor of `to`. */
  toDate: Date;
};

/** Inclusive whole-day window over a timestamp column: [from 00:00, to+1d 00:00). */
function timestampRange(fromDate: Date, toDate: Date) {
  return { gte: fromDate, lt: new Date(toDate.getTime() + 86_400_000) };
}

function shiftDays(dateStr: string, days: number): string {
  return new Date(
    new Date(`${dateStr}T00:00:00.000Z`).getTime() + days * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
}

/**
 * Default the window to the last 30 days (inclusive of today) when the
 * caller passes no dates — a report endpoint with no bounds must never
 * become an unbounded table scan.
 */
function resolveRange(range: ReportRange): ResolvedRange {
  const to = range.to ?? new Date().toISOString().slice(0, 10);
  const from = range.from ?? shiftDays(to, -29);
  return {
    from,
    to,
    fromDate: new Date(`${from}T00:00:00.000Z`),
    toDate: new Date(`${to}T00:00:00.000Z`),
  };
}

// ─── Shared result shapes ────────────────────────────────────────────────────

export type ReportSummary = {
  generatedAt: string;
  range: { from: string; to: string };
  headcount: {
    total: number;
    active: number;
    onLeave: number;
    inactive: number;
    byDepartment: Array<{ id: string; name: string; count: number }>;
  };
  attendance: {
    records: number;
    present: number;
    absent: number;
    halfDay: number;
    remote: number;
    /** (present + remote + halfDay) / records, 2dp string. */
    attendanceRate: string;
  };
  leave: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    cancelled: number;
    pendingDays: number;
  };
  payroll: {
    records: number;
    draft: number;
    final: number;
    /** Exact decimal string — Decimal summed with `.plus`. */
    netTotal: string;
    byMonth: Array<{ year: number; month: number; netTotal: string; records: number }>;
  };
  ai: {
    calls30d: number;
    byPurpose: Array<{ purpose: string; calls: number }>;
  };
};

export type OwnReportSummary = {
  range: { from: string; to: string };
  attendance: {
    records: number;
    present: number;
    absent: number;
    remote: number;
    halfDay: number;
    /** Summed (checkOut − checkIn) seconds / 3600, 2dp string. */
    totalHours: string;
  };
  leave: {
    total: number;
    approved: number;
    pending: number;
    /** Inclusive calendar days across APPROVED requests. */
    takenDays: number;
  };
  payroll: { netTotal: string; months: number };
};

export type CsvExport = { fileName: string; csv: string };

/** groupBy({_count._all}) rows → a lookup by status/purpose key. */
function tally<T extends string>(
  groups: Array<{ key: T; count: number }>,
): Map<T, number> {
  return new Map(groups.map((g) => [g.key, g.count]));
}

// ─── Org-wide summary ────────────────────────────────────────────────────────

/**
 * ORG-WIDE dashboard figures (ADMIN/HR). Headcount is a CURRENT snapshot
 * (it answers "how many people do we have now"); attendance/leave/payroll
 * are filtered to the resolved range; AI usage always covers the trailing
 * 30 days because it measures platform consumption, not HR periods.
 */
export async function computeSummary(
  range: ReportRange,
  actor: EmployeeScopeActor,
): Promise<ReportSummary> {
  if (!can(actor.role, "reports", "read")) throw errors.forbidden();
  const r = resolveRange(range);

  const attendanceWhereDate = { gte: r.fromDate, lte: r.toDate };
  const attendanceWhere = { date: attendanceWhereDate };
  const leaveWhere = { submittedAt: timestampRange(r.fromDate, r.toDate) };
  const payrollWhere = { createdAt: timestampRange(r.fromDate, r.toDate) };
  const aiWhere = {
    createdAt: timestampRange(
      new Date(Date.now() - 30 * 86_400_000),
      new Date(),
    ),
  };

  const [
    headcountGroups,
    departments,
    attendanceGroups,
    leaveGroups,
    pendingLeave,
    payrollStatusGroups,
    payrollMonthGroups,
    aiGroups,
    aiCalls,
  ] = await Promise.all([
    prisma.employee.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.department.findMany({
      select: {
        id: true,
        name: true,
        _count: { select: { employees: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.attendance.groupBy({
      by: ["status"],
      where: attendanceWhere,
      _count: { _all: true },
    }),
    prisma.leaveRequest.groupBy({
      by: ["status"],
      where: leaveWhere,
      _count: { _all: true },
    }),
    // Day counts can't be aggregated in SQL (inclusive span of two dates).
    prisma.leaveRequest.findMany({
      where: { ...leaveWhere, status: "PENDING" },
      select: { startDate: true, endDate: true },
    }),
    prisma.payrollRecord.groupBy({
      by: ["status"],
      where: payrollWhere,
      _count: { _all: true },
    }),
    prisma.payrollRecord.groupBy({
      by: ["year", "month"],
      where: payrollWhere,
      _count: { _all: true },
      // DB-side numeric sum is exact (base-10), like our Decimal math.
      _sum: { netPay: true },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    }),
    prisma.aiUsageLog.groupBy({
      by: ["purpose"],
      where: aiWhere,
      _count: { _all: true },
    }),
    prisma.aiUsageLog.count({ where: aiWhere }),
  ]);

  const headcount = tally(
    headcountGroups.map((g) => ({ key: g.status, count: g._count._all })),
  );
  const attendance = tally(
    attendanceGroups.map((g) => ({ key: g.status, count: g._count._all })),
  );
  const leave = tally(
    leaveGroups.map((g) => ({ key: g.status, count: g._count._all })),
  );
  const payrollStatus = tally(
    payrollStatusGroups.map((g) => ({ key: g.status, count: g._count._all })),
  );

  const records = [...attendance.values()].reduce((a, b) => a + b, 0);
  const attended =
    (attendance.get("PRESENT") ?? 0) +
    (attendance.get("REMOTE") ?? 0) +
    (attendance.get("HALF_DAY") ?? 0);

  // Exact money: reduce the per-month Decimal sums with `.plus`, then string.
  let netTotal = new Prisma.Decimal(0);
  for (const group of payrollMonthGroups) {
    netTotal = netTotal.plus(group._sum.netPay ?? 0);
  }

  return {
    generatedAt: new Date().toISOString(),
    range: { from: r.from, to: r.to },
    headcount: {
      total: [...headcount.values()].reduce((a, b) => a + b, 0),
      active: headcount.get("ACTIVE") ?? 0,
      onLeave: headcount.get("ON_LEAVE") ?? 0,
      inactive: headcount.get("INACTIVE") ?? 0,
      byDepartment: departments.map((d) => ({
        id: d.id,
        name: d.name,
        count: d._count.employees,
      })),
    },
    attendance: {
      records,
      present: attendance.get("PRESENT") ?? 0,
      absent: attendance.get("ABSENT") ?? 0,
      halfDay: attendance.get("HALF_DAY") ?? 0,
      remote: attendance.get("REMOTE") ?? 0,
      // 2dp string, not a float: JSON round-trips it unchanged.
      attendanceRate: records === 0 ? "0.00" : (attended / records).toFixed(2),
    },
    leave: {
      total: [...leave.values()].reduce((a, b) => a + b, 0),
      pending: leave.get("PENDING") ?? 0,
      approved: leave.get("APPROVED") ?? 0,
      rejected: leave.get("REJECTED") ?? 0,
      cancelled: leave.get("CANCELLED") ?? 0,
      pendingDays: pendingLeave.reduce(
        (sum, row) => sum + inclusiveDays(row.startDate, row.endDate),
        0,
      ),
    },
    payroll: {
      records: [...payrollStatus.values()].reduce((a, b) => a + b, 0),
      draft: payrollStatus.get("DRAFT") ?? 0,
      final: payrollStatus.get("FINAL") ?? 0,
      netTotal: money(netTotal) ?? "0",
      byMonth: payrollMonthGroups.map((g) => ({
        year: g.year,
        month: g.month,
        netTotal: money(g._sum.netPay) ?? "0",
        records: g._count._all,
      })),
    },
    ai: {
      calls30d: aiCalls,
      byPurpose: aiGroups.map((g) => ({
        purpose: g.purpose,
        calls: g._count._all,
      })),
    },
  };
}

// ─── Self-scoped summary (readOwn) ───────────────────────────────────────────

/**
 * The EMPLOYEE variant: ONLY the caller's own rows, scoped by
 * `actor.employeeId` which is derived from the session — a request body can
 * never widen it. An account with no linked employee has no attendance,
 * leave or payslips to summarize, so that's a 403 with a concrete reason,
 * not an empty (misleading) report.
 */
export async function computeOwnSummary(
  range: ReportRange,
  actor: EmployeeScopeActor,
): Promise<OwnReportSummary> {
  if (!can(actor.role, "reports", "readOwn")) throw errors.forbidden();
  const employeeId = actor.employeeId;
  if (!employeeId) {
    throw errors.forbidden("No employee record is linked to your account.");
  }
  const r = resolveRange(range);

  const [attendanceRows, leaveRows, payrollRows] = await Promise.all([
    // One employee over a bounded range — row fetch beats groupBy here, and
    // the hours sum needs checkIn/checkOut anyway.
    prisma.attendance.findMany({
      where: { employeeId, date: { gte: r.fromDate, lte: r.toDate } },
      select: { status: true, checkIn: true, checkOut: true },
    }),
    prisma.leaveRequest.findMany({
      where: { employeeId, submittedAt: timestampRange(r.fromDate, r.toDate) },
      select: { status: true, startDate: true, endDate: true },
    }),
    prisma.payrollRecord.findMany({
      where: { employeeId, createdAt: timestampRange(r.fromDate, r.toDate) },
      select: { netPay: true },
    }),
  ]);

  let totalMs = 0;
  const statusCounts = new Map<string, number>();
  for (const row of attendanceRows) {
    statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
    // Only complete pairs contribute hours — a missing check-out is not 0h.
    if (row.checkIn && row.checkOut) {
      totalMs += row.checkOut.getTime() - row.checkIn.getTime();
    }
  }

  let netTotal = new Prisma.Decimal(0);
  for (const row of payrollRows) netTotal = netTotal.plus(row.netPay);

  const approved = leaveRows.filter((row) => row.status === "APPROVED");

  return {
    range: { from: r.from, to: r.to },
    attendance: {
      records: attendanceRows.length,
      present: statusCounts.get("PRESENT") ?? 0,
      absent: statusCounts.get("ABSENT") ?? 0,
      remote: statusCounts.get("REMOTE") ?? 0,
      halfDay: statusCounts.get("HALF_DAY") ?? 0,
      totalHours: (totalMs / 3_600_000).toFixed(2),
    },
    leave: {
      total: leaveRows.length,
      approved: approved.length,
      pending: leaveRows.filter((row) => row.status === "PENDING").length,
      takenDays: approved.reduce(
        (sum, row) => sum + inclusiveDays(row.startDate, row.endDate),
        0,
      ),
    },
    payroll: {
      netTotal: money(netTotal) ?? "0",
      months: payrollRows.length,
    },
  };
}

// ─── CSV export ──────────────────────────────────────────────────────────────

/** RFC 4180 quoting; CRLF line endings for Excel compatibility. */
function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(header: string[], rows: string[][]): string {
  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

/**
 * Full (unpaginated) CSV for one report kind, within the resolved range.
 *
 * Requires `reports.export` (ADMIN/HR) — an EMPLOYEE's readOwn never
 * exports, so they are rejected here even though they can read a summary.
 * Money is emitted as exact decimal strings via `money()`; dates as
 * YYYY-MM-DD / ISO strings.
 */
export async function exportCsv(
  kind: ReportExportKind,
  range: ReportRange,
  actor: EmployeeScopeActor,
): Promise<CsvExport> {
  if (!can(actor.role, "reports", "export")) throw errors.forbidden();
  const r = resolveRange(range);

  let csv: string;
  switch (kind) {
    case "headcount": {
      // Snapshot of the current roster (like the summary's headcount block).
      const rows = await prisma.employee.findMany({
        select: {
          employeeCode: true,
          firstName: true,
          lastName: true,
          position: true,
          status: true,
          joinDate: true,
          department: { select: { name: true } },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      });
      csv = toCsv(
        ["employeeCode", "name", "department", "position", "status", "joinDate"],
        rows.map((row) => [
          row.employeeCode,
          `${row.firstName} ${row.lastName}`.trim(),
          row.department?.name ?? "",
          row.position,
          row.status,
          row.joinDate.toISOString().slice(0, 10),
        ]),
      );
      break;
    }
    case "attendance": {
      const rows = await prisma.attendance.findMany({
        where: { date: { gte: r.fromDate, lte: r.toDate } },
        select: {
          date: true,
          status: true,
          checkIn: true,
          checkOut: true,
          employee: { select: { employeeCode: true } },
        },
        orderBy: [{ date: "asc" }, { employee: { employeeCode: "asc" } }],
      });
      csv = toCsv(
        ["date", "employeeCode", "status", "checkIn", "checkOut", "hours"],
        rows.map((row) => [
          row.date.toISOString().slice(0, 10),
          row.employee.employeeCode,
          row.status,
          row.checkIn?.toISOString() ?? "",
          row.checkOut?.toISOString() ?? "",
          row.checkIn && row.checkOut
            ? ((row.checkOut.getTime() - row.checkIn.getTime()) / 3_600_000).toFixed(2)
            : "",
        ]),
      );
      break;
    }
    case "leave": {
      const rows = await prisma.leaveRequest.findMany({
        where: { submittedAt: timestampRange(r.fromDate, r.toDate) },
        select: {
          submittedAt: true,
          type: true,
          status: true,
          startDate: true,
          endDate: true,
          employee: { select: { employeeCode: true } },
        },
        orderBy: { submittedAt: "asc" },
      });
      csv = toCsv(
        ["submittedAt", "employeeCode", "type", "days", "status"],
        rows.map((row) => [
          row.submittedAt.toISOString(),
          row.employee.employeeCode,
          row.type,
          String(inclusiveDays(row.startDate, row.endDate)),
          row.status,
        ]),
      );
      break;
    }
    case "payroll": {
      const rows = await prisma.payrollRecord.findMany({
        where: { createdAt: timestampRange(r.fromDate, r.toDate) },
        select: {
          year: true,
          month: true,
          baseSalary: true,
          bonus: true,
          deduction: true,
          netPay: true,
          status: true,
          employee: { select: { employeeCode: true } },
        },
        orderBy: [
          { year: "asc" },
          { month: "asc" },
          { employee: { employeeCode: "asc" } },
        ],
      });
      csv = toCsv(
        ["year", "month", "employeeCode", "base", "bonus", "deduction", "net", "status"],
        rows.map((row) => [
          String(row.year),
          String(row.month),
          row.employee.employeeCode,
          money(row.baseSalary) ?? "",
          money(row.bonus) ?? "",
          money(row.deduction) ?? "",
          money(row.netPay) ?? "",
          row.status,
        ]),
      );
      break;
    }
  }

  return { fileName: `${kind}-${r.from}_${r.to}.csv`, csv };
}
