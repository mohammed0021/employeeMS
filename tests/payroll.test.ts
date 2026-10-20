/**
 * Payroll: exact Decimal money math (values chosen so IEEE-754 floats would
 * drift), the DRAFT → FINAL immutability rule, RBAC, and readOwn scoping.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPayroll,
  getPayroll,
  listPayrolls,
  modifyPayroll,
} from "@/lib/services/payroll";
import type { CreatePayrollInput } from "@/lib/validation/payroll";
import type { ListQuery } from "@/lib/pagination";
import {
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

const query: ListQuery = { page: 1, limit: 50 };
const byCreatedAt = { field: "createdAt", dir: "asc" } as const;

let admin!: UserFixture;
let employeeA!: EmployeeFixture;
let employeeB!: EmployeeFixture;
let userA!: UserFixture;
let userB!: UserFixture;

beforeAll(async () => {
  admin = await makeUser({ role: "ADMIN" });
  const dept: DeptFixture = await makeDept();
  employeeA = await makeEmployee({ departmentId: dept.id });
  employeeB = await makeEmployee({ departmentId: dept.id });
  userA = await makeUser({ role: "EMPLOYEE", employeeId: employeeA.id });
  userB = await makeUser({ role: "EMPLOYEE", employeeId: employeeB.id });
});

afterAll(async () => {
  await runCleanups();
});

/** 1000.10 + 0.20 − 0.30 → "1000.00". Float arithmetic gives 1000.0000000000001. */
function exactInput(employeeId: string, month: number): CreatePayrollInput {
  return { employeeId, month, year: 2026, baseSalary: "1000.10", bonus: "0.20", deduction: "0.30" };
}

describe("createPayroll (generate) — exact Decimal math", () => {
  it("computes gross/net as base-10 decimals, string-exact", async () => {
    const dto = await createPayroll(scopeActorFor(admin), exactInput(employeeA.id, 10));

    expect(dto.baseSalary).toBe("1000.10");
    expect(dto.bonus).toBe("0.20");
    expect(dto.deduction).toBe("0.30");
    expect(dto.grossPay).toBe("1000.30");
    // The float-drift tripwire: these two must differ in JS, yet the service
    // returns the mathematically exact value.
    expect(1000.10 + 0.2 - 0.3).not.toBe(1000);
    expect(dto.netPay).toBe("1000.00");
    expect(dto.status).toBe("DRAFT");
    expect(dto.finalizedAt).toBeNull();
  });

  it("maps a duplicate (employee, month, year) to 409", async () => {
    await expectAppError(
      createPayroll(scopeActorFor(admin), exactInput(employeeA.id, 10)),
      409,
      "CONFLICT",
    );
  });

  it("denies EMPLOYEE generation with 403 (`create` is not in their matrix)", async () => {
    await expectAppError(
      createPayroll(scopeActorFor(userA), exactInput(employeeA.id, 11)),
      403,
      "FORBIDDEN",
    );
  });

  it("rejects a negative deduction with 400 before any write", async () => {
    await expectAppError(
      createPayroll(scopeActorFor(admin), {
        employeeId: employeeB.id,
        month: 1,
        year: 2026,
        baseSalary: "100.00",
        deduction: "-0.01",
      }),
      400,
      "VALIDATION_ERROR",
    );
  });
});

describe("modifyPayroll — DRAFT edits, FINAL immutability", () => {
  it("recomputes the net exactly when a DRAFT deduction changes", async () => {
    const created = await createPayroll(
      scopeActorFor(admin),
      exactInput(employeeB.id, 10),
    );
    const updated = await modifyPayroll(scopeActorFor(admin), created.id, {
      intent: "update",
      update: { deduction: "0.10" },
    });
    expect(updated.deduction).toBe("0.10");
    expect(updated.grossPay).toBe("1000.30");
    expect(updated.netPay).toBe("1000.20");
    expect(updated.status).toBe("DRAFT");
  });

  it("finalizes a DRAFT and stamps the finalizer", async () => {
    const finalized = await modifyPayroll(scopeActorFor(admin), await idOf(employeeA.id), {
      intent: "finalize",
      finalize: true,
    });
    expect(finalized.status).toBe("FINAL");
    expect(finalized.finalizedAt).not.toBeNull();

    const row = await getPayroll(finalized.id, scopeActorFor(admin));
    expect(row.status).toBe("FINAL");
    // A's record: 1000.10 + 0.20 − 0.30 = 1000.00 exactly.
    expect(row.netPay).toBe("1000.00");
  });

  it("rejects any edit to a FINAL record with 409 CONFLICT", async () => {
    const id = await idOf(employeeA.id);
    const error = await expectAppError(
      modifyPayroll(scopeActorFor(admin), id, {
        intent: "update",
        update: { bonus: "999.99" },
      }),
      409,
      "CONFLICT",
    );
    expect(error.message).toMatch(/immutable/i);

    // And the row really is unchanged.
    const row = await getPayroll(id, scopeActorFor(admin));
    expect(row.bonus).toBe("0.20");
    expect(row.netPay).toBe("1000.00");
  });

  it("refuses to finalize a record that is already FINAL with 409", async () => {
    await expectAppError(
      modifyPayroll(scopeActorFor(admin), await idOf(employeeA.id), {
        intent: "finalize",
        finalize: true,
      }),
      409,
      "CONFLICT",
    );
  });
});

describe("readOwn scoping (PERMISSIONS.md hard rule 4)", () => {
  it("EMPLOYEE sees only their own payslips, never the other employee's", async () => {
    const mine = await getPayroll(await idOf(employeeA.id), scopeActorFor(userA));
    expect(mine.employeeId).toBe(employeeA.id);
    expect(mine.netPay).toBe("1000.00"); // own payslip amounts are shown

    await expectAppError(
      getPayroll(await idOf(employeeB.id), scopeActorFor(userA)),
      403,
      "FORBIDDEN",
    );

    const ownPage = await listPayrolls(query, {}, byCreatedAt, scopeActorFor(userA));
    expect(ownPage.items.map((item) => item.employeeId)).toEqual([employeeA.id]);
    expect(ownPage.total).toBe(1);

    // A foreign ?employeeId= filter cannot widen the scope either: the service
    // OVERRIDES it with the caller's own employeeId (buildWhere), so the
    // answer is their own payslip — never the other employee's.
    const hijack = await listPayrolls(
      query,
      { employeeId: employeeB.id },
      byCreatedAt,
      scopeActorFor(userA),
    );
    expect(hijack.items.map((item) => item.employeeId)).toEqual([employeeA.id]);
    expect(hijack.total).toBe(1);

    const adminPage = await listPayrolls(query, {}, byCreatedAt, scopeActorFor(admin));
    expect(adminPage.total).toBe(2);
  });
});

/** The one payroll row per employee in this file (unique per period). */
async function idOf(employeeId: string): Promise<string> {
  const row = await listPayrolls(query, { employeeId }, byCreatedAt, scopeActorFor(admin));
  if (row.items.length !== 1) {
    throw new Error(`expected exactly one payroll row for ${employeeId}, got ${row.items.length}`);
  }
  return row.items[0].id;
}
