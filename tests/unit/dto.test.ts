import { describe, expect, it } from "vitest";
import {
  canSeeSalary,
  inclusiveDays,
  money,
  toAttendanceDto,
  toDepartmentDto,
  toEmployeeDto,
  toEmployeeRef,
  toLeaveRequestDto,
  toPayrollDto,
  type Viewer,
} from "@/lib/dto";

/** Minimal Decimal stand-in: only `toString()` is used by the mappers. */
const dec = (value: string) => ({ toString: () => value });

const ADMIN: Viewer = { role: "ADMIN", employeeId: null };
const HR: Viewer = { role: "HR", employeeId: null };
const EMPLOYEE_SELF: Viewer = { role: "EMPLOYEE", employeeId: "emp-1" };
const EMPLOYEE_OTHER: Viewer = { role: "EMPLOYEE", employeeId: "emp-2" };

const employeeRow = {
  id: "emp-1",
  employeeCode: "EMP-001",
  firstName: "Ayesha",
  lastName: "Khan",
  email: "emp-001@example.com",
  phone: null,
  position: "Engineer",
  joinDate: new Date("2022-03-14T00:00:00.000Z"),
  salary: dec("95000.00"),
  status: "ACTIVE" as const,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  department: { id: "dept-1", name: "Engineering" },
};

describe("salary redaction (PERMISSIONS.md hard rule 4)", () => {
  it("exposes salary to ADMIN and HR only", () => {
    expect(canSeeSalary("ADMIN")).toBe(true);
    expect(canSeeSalary("HR")).toBe(true);
    expect(canSeeSalary("EMPLOYEE")).toBe(false);
  });

  it("strips salary for EMPLOYEE even when reading their OWN record", () => {
    // The failure mode is "missing", never "leaked".
    const own = toEmployeeDto(employeeRow, EMPLOYEE_SELF);
    expect(own.salary).toBeNull();
    // ...while everything else about the record is still visible.
    expect(own.fullName).toBe("Ayesha Khan");
    expect(own.employeeCode).toBe("EMP-001");
  });

  it("keeps salary for privileged roles", () => {
    expect(toEmployeeDto(employeeRow, ADMIN).salary).toBe("95000.00");
    expect(toEmployeeDto(employeeRow, HR).salary).toBe("95000.00");
  });

  it("never emits password-adjacent fields", () => {
    const dto = toEmployeeDto(employeeRow, ADMIN) as unknown as Record<string, unknown>;
    expect(Object.keys(dto)).not.toContain("passwordHash");
    expect(Object.keys(dto)).not.toContain("user");
  });
});

describe("money serialization", () => {
  it("passes Decimal-like values through exactly (no float rounding)", () => {
    expect(money(dec("12345678901234.56"))).toBe("12345678901234.56");
    expect(money(dec("0.10"))).toBe("0.10");
  });

  it("maps null/undefined to null", () => {
    expect(money(null)).toBeNull();
    expect(money(undefined)).toBeNull();
  });

  it("emits strings, never numbers, from the employee DTO", () => {
    expect(typeof toEmployeeDto(employeeRow, ADMIN).salary).toBe("string");
  });
});

describe("toPayrollDto defence in depth", () => {
  const row = {
    id: "pay-1",
    employeeId: "emp-1",
    month: 10,
    year: 2026,
    baseSalary: dec("95000.00"),
    bonus: dec("1500.00"),
    deduction: dec("0.00"),
    grossPay: dec("96500.00"),
    netPay: dec("96500.00"),
    status: "FINAL" as const,
    finalizedAt: new Date("2026-10-31T00:00:00.000Z"),
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-31T00:00:00.000Z"),
    employee: null,
  };

  it("shows amounts to privileged roles", () => {
    const dto = toPayrollDto(row, ADMIN);
    expect(dto.netPay).toBe("96500.00");
    expect(dto.grossPay).toBe("96500.00");
  });

  it("shows amounts on the owner's own payslip", () => {
    expect(toPayrollDto(row, EMPLOYEE_SELF).netPay).toBe("96500.00");
  });

  it("zeroes amounts if a row reaches the wrong employee", () => {
    // Scoping in the query is the real guard; this is the safety net.
    const dto = toPayrollDto(row, EMPLOYEE_OTHER);
    expect(dto.netPay).toBe("0");
    expect(dto.baseSalary).toBe("0");
    // Non-sensitive shape still intact so the row is renderable.
    expect(dto.year).toBe(2026);
    expect(dto.month).toBe(10);
  });
});

describe("date mapping", () => {
  it("renders @db.Date values as YYYY-MM-DD regardless of local TZ", () => {
    const dto = toAttendanceDto({
      id: "a1",
      employeeId: "emp-1",
      date: new Date("2026-01-15T00:00:00.000Z"),
      checkIn: new Date("2026-01-15T08:45:00.000Z"),
      checkOut: null,
      status: "PRESENT",
      note: null,
      recordedById: null,
      createdAt: new Date("2026-01-15T00:00:00.000Z"),
      updatedAt: new Date("2026-01-15T00:00:00.000Z"),
    });
    expect(dto.date).toBe("2026-01-15");
    expect(dto.checkOut).toBeNull();
    expect(dto.checkIn).toBe("2026-01-15T08:45:00.000Z");
  });

  it("counts leave days inclusively", () => {
    expect(inclusiveDays(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"))).toBe(1);
    expect(inclusiveDays(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-31T00:00:00Z"))).toBe(31);
    expect(inclusiveDays(new Date("2026-02-27T00:00:00Z"), new Date("2026-03-02T00:00:00Z"))).toBe(4);
  });

  it("computes leave days from UTC calendar dates, not elapsed ms", () => {
    // Would be off-by-one if a local timezone were used instead.
    const dto = toLeaveRequestDto({
      id: "l1",
      employeeId: "emp-1",
      startDate: new Date("2026-03-01T00:00:00Z"),
      endDate: new Date("2026-03-05T00:00:00Z"),
      type: "ANNUAL",
      reason: "Trip",
      status: "PENDING",
      decisionReason: null,
      decidedById: null,
      decidedAt: null,
      cancelledAt: null,
      submittedAt: new Date("2026-02-20T00:00:00Z"),
      createdAt: new Date("2026-02-20T00:00:00Z"),
      updatedAt: new Date("2026-02-20T00:00:00Z"),
    });
    expect(dto.days).toBe(5);
    expect(dto.startDate).toBe("2026-03-01");
    expect(dto.endDate).toBe("2026-03-05");
  });
});

describe("referential DTOs", () => {
  it("builds a full name without double spaces", () => {
    expect(toEmployeeRef(employeeRow).fullName).toBe("Ayesha Khan");
  });

  it("reports employee counts from _count when present", () => {
    expect(
      toDepartmentDto({
        id: "d1",
        name: "Engineering",
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { employees: 7 },
      }).employeeCount,
    ).toBe(7);
    // Falls back to 0 when no count was selected.
    expect(
      toDepartmentDto({
        id: "d2",
        name: "Ops",
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).employeeCount,
    ).toBe(0);
  });
});
