/**
 * Reports: org-wide summary over fixtures (with a baseline captured BEFORE the
 * fixtures, so every figure is asserted as "what was already there + exactly
 * what this file added"), the EMPLOYEE self-scoped summary, and the export
 * gate.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { computeOwnSummary, computeSummary, exportCsv } from "@/lib/services/reports";
import { createPayroll } from "@/lib/services/payroll";
import { recordAttendance } from "@/lib/services/attendance";
import { submitLeaveRequest, decideLeaveRequest } from "@/lib/services/leave";
import type { ReportRange } from "@/lib/validation/reports";
import { inclusiveDays } from "@/lib/dto";
import {
  expectAppError,
  expectDecimalEq,
  makeDept,
  makeEmployee,
  makeUser,
  runCleanups,
  scopeActorFor,
  type DeptFixture,
  type EmployeeFixture,
  type UserFixture,
} from "./helpers";

/** Wide explicit window: every fixture row lands inside it, no default-window drift. */
const RANGE: ReportRange = { from: "2000-01-01", to: "2100-12-31" };
const rangeFrom = new Date("2000-01-01T00:00:00.000Z");
const rangeToExclusive = new Date("2101-01-01T00:00:00.000Z");
const rangeToInclusive = new Date("2100-12-31T00:00:00.000Z");

type Baseline = {
  employees: number;
  active: number;
  onLeave: number;
  attendance: number;
  present: number;
  remote: number;
  leave: number;
  pending: number;
  approved: number;
  pendingDays: number;
  payrollRows: number;
  payrollFinal: number;
  payrollNet: Prisma.Decimal;
};

let baseline!: Baseline;
let admin!: UserFixture;
let userA!: UserFixture;
let userB!: UserFixture;
let dept!: DeptFixture;
let employeeA!: EmployeeFixture;
let employeeB!: EmployeeFixture;

async function captureBaseline(): Promise<Baseline> {
  const [employees, employeeGroups, attendanceGroups, leaveGroups, pendingRows, payrollRows] =
    await Promise.all([
      prisma.employee.count(),
      prisma.employee.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.attendance.groupBy({
        by: ["status"],
        where: { date: { gte: rangeFrom, lte: rangeToInclusive } },
        _count: { _all: true },
      }),
      prisma.leaveRequest.groupBy({
        by: ["status"],
        where: { submittedAt: { gte: rangeFrom, lt: rangeToExclusive } },
        _count: { _all: true },
      }),
      prisma.leaveRequest.findMany({
        where: { status: "PENDING", submittedAt: { gte: rangeFrom, lt: rangeToExclusive } },
        select: { startDate: true, endDate: true },
      }),
      prisma.payrollRecord.findMany({
        where: { createdAt: { gte: rangeFrom, lt: rangeToExclusive } },
        select: { netPay: true, status: true },
      }),
    ]);

  const empCount = new Map(employeeGroups.map((g) => [g.status, g._count._all]));
  const attCount = new Map(attendanceGroups.map((g) => [g.status, g._count._all]));
  const leaveCount = new Map(leaveGroups.map((g) => [g.status, g._count._all]));

  let payrollNet = new Prisma.Decimal(0);
  for (const row of payrollRows) payrollNet = payrollNet.plus(row.netPay);

  return {
    employees,
    active: empCount.get("ACTIVE") ?? 0,
    onLeave: empCount.get("ON_LEAVE") ?? 0,
    attendance: [...attCount.values()].reduce((a, b) => a + b, 0),
    present: attCount.get("PRESENT") ?? 0,
    remote: attCount.get("REMOTE") ?? 0,
    leave: [...leaveCount.values()].reduce((a, b) => a + b, 0),
    pending: leaveCount.get("PENDING") ?? 0,
    approved: leaveCount.get("APPROVED") ?? 0,
    pendingDays: pendingRows.reduce((sum, r) => sum + inclusiveDays(r.startDate, r.endDate), 0),
    payrollRows: payrollRows.length,
    payrollFinal: payrollRows.filter((r) => r.status === "FINAL").length,
    payrollNet,
  };
}

beforeAll(async () => {
  baseline = await captureBaseline();

  admin = await makeUser({ role: "ADMIN" });
  dept = await makeDept();
  employeeA = await makeEmployee({ departmentId: dept.id, status: "ACTIVE" });
  employeeB = await makeEmployee({ departmentId: dept.id, status: "ON_LEAVE" });
  userA = await makeUser({ role: "EMPLOYEE", employeeId: employeeA.id });
  userB = await makeUser({ role: "EMPLOYEE", employeeId: employeeB.id });

  // Attendance: 8h PRESENT + 6h REMOTE for A; none for B.
  await recordAttendance(scopeActorFor(admin), {
    employeeId: employeeA.id,
    date: "2026-05-04",
    status: "PRESENT",
    checkIn: "09:00",
    checkOut: "17:00",
  });
  await recordAttendance(scopeActorFor(admin), {
    employeeId: employeeA.id,
    date: "2026-05-05",
    status: "REMOTE",
    checkIn: "10:00",
    checkOut: "16:00",
  });

  // Leave: A pending 3 days, B approved 2 days.
  const leaveA = await submitLeaveRequest(scopeActorFor(userA), {
    startDate: "2026-06-01",
    endDate: "2026-06-03",
    type: "ANNUAL",
    reason: "Fixture leave for A",
  });
  const leaveB = await submitLeaveRequest(scopeActorFor(userB), {
    startDate: "2026-06-10",
    endDate: "2026-06-11",
    type: "SICK",
    reason: "Fixture leave for B",
  });
  await decideLeaveRequest(scopeActorFor(admin), leaveB.id, { decision: "APPROVED" });

  // Payroll: A net 1000.00, B net 2000.10 (both createdAt = now, in range).
  await createPayroll(scopeActorFor(admin), {
    employeeId: employeeA.id,
    month: 3,
    year: 2026,
    baseSalary: "1000.00",
  });
  await createPayroll(scopeActorFor(admin), {
    employeeId: employeeB.id,
    month: 4,
    year: 2026,
    baseSalary: "2000.10",
  });
});

afterAll(async () => {
  await runCleanups();
});

describe("computeSummary (org-wide)", () => {
  it("reports exactly baseline + the fixtures this file created", async () => {
    const summary = await computeSummary(RANGE, scopeActorFor(admin));

    // Headcount — current snapshot.
    expect(summary.headcount.total).toBe(baseline.employees + 2);
    expect(summary.headcount.active).toBe(baseline.active + 1); // A active, B on leave
    expect(summary.headcount.onLeave).toBe(baseline.onLeave + 1);
    const ourDept = summary.headcount.byDepartment.find((d) => d.id === dept.id);
    expect(ourDept).toMatchObject({ name: dept.name, count: 2 });

    // Attendance — filtered to the range.
    expect(summary.attendance.records).toBe(baseline.attendance + 2);
    expect(summary.attendance.present).toBe(baseline.present + 1);
    expect(summary.attendance.remote).toBe(baseline.remote + 1);
    expect(summary.attendance.attendanceRate).toMatch(/^\d+\.\d{2}$/);

    // Leave.
    expect(summary.leave.total).toBe(baseline.leave + 2);
    expect(summary.leave.pending).toBe(baseline.pending + 1);
    expect(summary.leave.approved).toBe(baseline.approved + 1);
    expect(summary.leave.pendingDays).toBe(baseline.pendingDays + 3);

    // Payroll — exact decimal strings, summed with Decimal (never floats).
    expect(summary.payroll.records).toBe(baseline.payrollRows + 2);
    // The two rows this file creates via createPayroll are DRAFT (the service
    // never sets FINAL on create), so the FINAL bucket is unchanged.
    expect(summary.payroll.final).toBe(baseline.payrollFinal);
    const expectedNet = baseline.payrollNet.plus("1000.00").plus("2000.10");
    expectDecimalEq(summary.payroll.netTotal, expectedNet.toString());

    // The per-month rows must add up to the reported total (same Decimal math).
    const byMonthSum = summary.payroll.byMonth.reduce(
      (acc, month) => acc.plus(month.netTotal),
      new Prisma.Decimal(0),
    );
    expectDecimalEq(summary.payroll.netTotal, byMonthSum.toString());
  });

  it("denies EMPLOYEE the org-wide summary with 403", async () => {
    await expectAppError(computeSummary(RANGE, scopeActorFor(userA)), 403, "FORBIDDEN");
  });
});

describe("computeOwnSummary (readOwn, EMPLOYEE)", () => {
  it("returns ONLY the caller's own numbers", async () => {
    const own = await computeOwnSummary(RANGE, scopeActorFor(userA));

    // Attendance: 8h + 6h for A, B has none — so these are A's alone.
    expect(own.attendance.records).toBe(2);
    expect(own.attendance.present).toBe(1);
    expect(own.attendance.remote).toBe(1);
    expect(own.attendance.totalHours).toBe("14.00");

    // Leave: only A's PENDING request; B's approved 2-day row is not here.
    expect(own.leave.total).toBe(1);
    expect(own.leave.pending).toBe(1);
    expect(own.leave.approved).toBe(0);
    expect(own.leave.takenDays).toBe(0);

    // Payroll: A's 1000.00 — never B's 2000.10.
    expect(own.payroll.netTotal).toBe("1000.00");
    expect(own.payroll.months).toBe(1);
    expect(own.range).toEqual({ from: RANGE.from, to: RANGE.to });
  });

  it("mirrors the OTHER employee's figures when they are the caller", async () => {
    const own = await computeOwnSummary(RANGE, scopeActorFor(userB));
    expect(own.attendance.records).toBe(0);
    expect(own.attendance.totalHours).toBe("0.00");
    expect(own.leave.approved).toBe(1);
    expect(own.leave.takenDays).toBe(2);
    expect(own.payroll.netTotal).toBe("2000.10");
    expect(own.payroll.months).toBe(1);
  });
});

describe("exportCsv", () => {
  it("denies EMPLOYEE exports with 403 (readOwn never exports)", async () => {
    await expectAppError(exportCsv("headcount", RANGE, scopeActorFor(userA)), 403, "FORBIDDEN");
    await expectAppError(exportCsv("payroll", RANGE, scopeActorFor(userB)), 403, "FORBIDDEN");
  });

  it("produces a CSV for ADMIN containing the fixture rows", async () => {
    const result = await exportCsv("payroll", RANGE, scopeActorFor(admin));
    expect(result.fileName).toMatch(/^payroll-2000-01-01_2100-12-31\.csv$/);
    expect(result.csv.split("\r\n")[0]).toBe(
      "year,month,employeeCode,base,bonus,deduction,net,status",
    );
    expect(result.csv).toContain(employeeA.employeeCode);
    expect(result.csv).toContain("1000.00");
    expect(result.csv).toContain("2000.10");
  });
});
