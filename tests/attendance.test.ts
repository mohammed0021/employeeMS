/**
 * Attendance service: recording with derived hours, the check-out/check-in
 * ordering rule (400), the unique per-day constraint (409), and the audit row
 * a correction writes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { correctAttendance, recordAttendance } from "@/lib/services/attendance";
import type { RecordAttendanceInput } from "@/lib/validation/attendance";
import { AUDIT_ACTIONS } from "@/lib/audit/audit";
import {
  actorFor,
  expectAppError,
  makeDept,
  makeEmployee,
  makeUser,
  runCleanups,
  scopeActorFor,
  type DeptFixture,
  type EmployeeFixture,
  type UserFixture,
} from "./helpers";

let admin!: UserFixture;
let employeeUser!: UserFixture;
let dept!: DeptFixture;
let employee!: EmployeeFixture;

beforeAll(async () => {
  admin = await makeUser({ role: "ADMIN" });
  dept = await makeDept();
  employee = await makeEmployee({ departmentId: dept.id });
  employeeUser = await makeUser({ role: "EMPLOYEE", employeeId: employee.id });
});

afterAll(async () => {
  await runCleanups();
});

/**
 * Next free calendar date for this file. Each call advances a cursor, so the
 * `@@unique([employeeId, date])` constraint is never tripped by two tests
 * landing on the same day (27 slots is plenty for this file's row count).
 */
let dayCursor = 1;
function nextDate(): string {
  dayCursor += 1;
  return `2026-05-${String(((dayCursor - 1) % 27) + 1).padStart(2, "0")}`;
}

describe("recordAttendance", () => {
  it("records a day and derives the hours from the anchored times", async () => {
    const input: RecordAttendanceInput = {
      employeeId: employee.id,
      date: nextDate(),
      status: "PRESENT",
      checkIn: "09:00",
      checkOut: "17:00",
      note: "shift A",
    };
    const dto = await recordAttendance(actorFor(admin), input);

    expect(dto.employeeId).toBe(employee.id);
    expect(dto.date).toBe(input.date);
    expect(dto.checkIn).toBe(`${input.date}T09:00:00.000Z`);
    expect(dto.checkOut).toBe(`${input.date}T17:00:00.000Z`);
    // Hours are derived from the pair — 8h exactly, no local-timezone drift.
    const hours =
      (Date.parse(dto.checkOut!) - Date.parse(dto.checkIn!)) / 3_600_000;
    expect(hours).toBe(8);
    expect(dto.recordedById).toBe(admin.id);
    expect(dto.status).toBe("PRESENT");

    const row = await prisma.attendance.findUnique({ where: { id: dto.id } });
    expect(row?.checkIn?.toISOString()).toBe(`${input.date}T09:00:00.000Z`);
  });

  it("rejects check-out before check-in with 400 VALIDATION_ERROR", async () => {
    await expectAppError(
      recordAttendance(actorFor(admin), {
        employeeId: employee.id,
        date: nextDate(),
        status: "PRESENT",
        checkIn: "09:00",
        checkOut: "08:00",
      }),
      400,
      "VALIDATION_ERROR",
    );
  });

  it("rejects check-out EQUAL to check-in (zero-duration day)", async () => {
    await expectAppError(
      recordAttendance(actorFor(admin), {
        employeeId: employee.id,
        date: nextDate(),
        status: "PRESENT",
        checkIn: "09:00",
        checkOut: "09:00",
      }),
      400,
      "VALIDATION_ERROR",
    );
  });

  it("maps a second record for the same employee/day to 409", async () => {
    const date = nextDate();
    const base: RecordAttendanceInput = {
      employeeId: employee.id,
      date,
      status: "PRESENT",
      checkIn: "09:00",
      checkOut: "17:00",
    };
    await recordAttendance(actorFor(admin), base);
    await expectAppError(recordAttendance(actorFor(admin), base), 409, "CONFLICT");
  });

  it("denies EMPLOYEE the create action with 403", async () => {
    await expectAppError(
      recordAttendance(actorFor(employeeUser), {
        employeeId: employee.id,
        date: nextDate(),
        status: "PRESENT",
      }),
      403,
      "FORBIDDEN",
    );
  });

  it("404s on an unknown employee", async () => {
    await expectAppError(
      recordAttendance(actorFor(admin), {
        employeeId: "no-such-employee",
        date: nextDate(),
        status: "PRESENT",
      }),
      404,
      "NOT_FOUND",
    );
  });
});

describe("correctAttendance", () => {
  it("applies the correction and writes an ATTENDANCE_CORRECTED audit row", async () => {
    const date = nextDate();
    const dto = await recordAttendance(actorFor(admin), {
      employeeId: employee.id,
      date,
      status: "PRESENT",
      checkIn: "09:00",
      checkOut: "17:00",
    });

    const corrected = await correctAttendance(actorFor(admin), dto.id, {
      status: "HALF_DAY",
      checkOut: "13:00",
      note: "left early",
    });
    expect(corrected.status).toBe("HALF_DAY");
    expect(corrected.checkOut).toBe(`${date}T13:00:00.000Z`);
    expect(corrected.note).toBe("left early");

    const audit = await prisma.auditLog.findFirst({
      where: { action: AUDIT_ACTIONS.ATTENDANCE_CORRECTED, entityId: dto.id },
    });
    expect(audit, "correctAttendance must append an audit row").not.toBeNull();
    expect(audit?.outcome).toBe("SUCCESS");
    expect(audit?.actorId).toBe(admin.id);
    expect(audit?.entityType).toBe("Attendance");
  });

  it("rejects a correction that would order the times wrongly", async () => {
    const date = nextDate();
    const dto = await recordAttendance(actorFor(admin), {
      employeeId: employee.id,
      date,
      status: "PRESENT",
      checkIn: "10:00",
      checkOut: "18:00",
    });
    await expectAppError(
      correctAttendance(actorFor(admin), dto.id, { checkOut: "09:00" }),
      400,
      "VALIDATION_ERROR",
    );
  });

  it("denies EMPLOYEE (no attendance update permission) with 403", async () => {
    const dto = await recordAttendance(actorFor(admin), {
      employeeId: employee.id,
      date: nextDate(),
      status: "PRESENT",
      checkIn: "09:00",
      checkOut: "17:00",
    });
    await expectAppError(
      correctAttendance(scopeActorFor(employeeUser), dto.id, { status: "ABSENT" }),
      403,
      "FORBIDDEN",
    );
  });
});
