/**
 * Employee service: create → read, list paging/search, and the DTO viewer
 * boundary (salary visible to ADMIN, null for EMPLOYEE — PERMISSIONS.md hard
 * rule 4).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEmployee, getEmployee, listEmployees } from "@/lib/services/employees";
import type { CreateEmployeeInput, EmployeeFilters } from "@/lib/validation/employees";
import type { ListQuery } from "@/lib/pagination";
import {
  expectAppError,
  makeDept,
  makeEmployee,
  makeUser,
  runCleanups,
  scopeActorFor,
  trackEmployee,
  uniqueId,
  type DeptFixture,
  type EmployeeFixture,
  type UserFixture,
} from "./helpers";

const query = (page = 1, limit = 20): ListQuery => ({ page, limit });
const byLastName = { field: "lastName", dir: "asc" } as const;

let admin!: UserFixture;
let employeeUser!: UserFixture; // linked to `self`
let dept!: DeptFixture;
let self!: EmployeeFixture; // the record `employeeUser` owns
let stranger!: EmployeeFixture; // somebody else's record

beforeAll(async () => {
  admin = await makeUser({ role: "ADMIN" });
  dept = await makeDept();
  self = await makeEmployee({ departmentId: dept.id, salary: "95000.55" });
  stranger = await makeEmployee({ departmentId: dept.id, salary: "1234.56" });
  employeeUser = await makeUser({ role: "EMPLOYEE", employeeId: self.id });
});

afterAll(async () => {
  await runCleanups();
});

function createInput(departmentId: string, tag: string): CreateEmployeeInput {
  return {
    employeeCode: `C${tag}`.slice(0, 40),
    firstName: "Ada",
    lastName: `Lovelace-${tag}`,
    email: `ada-${tag}@example.test`,
    position: "Engineer",
    joinDate: new Date("2024-05-01T00:00:00.000Z"),
    salary: 95000.55,
    departmentId,
  };
}

/** `createEmployee` + register the row for this file's cleanup pass. */
async function createTracked(input: CreateEmployeeInput) {
  const actor = scopeActorFor(admin);
  const dto = await createEmployee(actor, input);
  trackEmployee(dto.id);
  return dto;
}

describe("createEmployee / getEmployee", () => {
  it("creates a record and reads it back (ADMIN sees the exact salary)", async () => {
    const tag = uniqueId("c");
    const created = await createTracked(createInput(dept.id, tag));

    expect(created.id).toBeTruthy();
    expect(created.email).toBe(`ada-${tag}@example.test`);
    expect(created.fullName).toBe(`Ada Lovelace-${tag}`);
    expect(created.salary).toBe("95000.55"); // Decimal, never a float
    expect(created.department).toEqual({ id: dept.id, name: dept.name });

    const fetched = await getEmployee(created.id, scopeActorFor(admin));
    expect(fetched).toEqual(created);
  });

  it("rejects an unknown department before writing the employee", async () => {
    const tag = uniqueId("c");
    await expectAppError(
      createEmployee(scopeActorFor(admin), createInput("does-not-exist", tag)),
      404,
      "NOT_FOUND",
    );
  });

  it("maps a duplicate employee code to 409, not raw SQL", async () => {
    const input = createInput(dept.id, uniqueId("c"));
    await createTracked(input);
    const actor = scopeActorFor(admin);
    const error = await expectAppError(createEmployee(actor, input), 409, "CONFLICT");
    expect(error.message).toMatch(/already exists/i);
  });
});

describe("listEmployees paging and search", () => {
  it("pages with a stable total and finds rows by search term", async () => {
    const tag = uniqueId("s");
    const searchDept = await makeDept();
    const created: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const dto = await createTracked({
        ...createInput(searchDept.id, `${tag}${i}`),
        lastName: `Paged-${tag}${i}`,
      });
      created.push(dto.id);
    }

    const filters: EmployeeFilters = { q: `Paged-${tag}` };
    const page1 = await listEmployees(query(1, 2), filters, byLastName, scopeActorFor(admin));
    expect(page1.total).toBe(3);
    expect(page1.pages).toBe(2);
    expect(page1.items).toHaveLength(2);

    const page2 = await listEmployees(query(2, 2), filters, byLastName, scopeActorFor(admin));
    expect(page2.total).toBe(3);
    expect(page2.items).toHaveLength(1);

    const ids = [...page1.items, ...page2.items].map((item) => item.id);
    expect(new Set(ids)).toEqual(new Set(created));

    // No match → empty page, not an error.
    const none = await listEmployees(
      query(1, 20),
      { q: uniqueId("nope") },
      byLastName,
      scopeActorFor(admin),
    );
    expect(none.total).toBe(0);
    expect(none.items).toEqual([]);
  });

  it("filters by departmentId", async () => {
    const other = await makeDept();
    const tag = uniqueId("f");
    const mine = await createTracked({
      ...createInput(other.id, tag),
      lastName: `Filtered-${tag}`,
    });

    const page = await listEmployees(
      query(1, 50),
      { departmentId: other.id },
      byLastName,
      scopeActorFor(admin),
    );
    expect(page.items.map((item) => item.id)).toEqual([mine.id]);
  });
});

describe("EMPLOYEE scoping (DTO viewer + readOwn)", () => {
  it("redacts salary on the employee's OWN record for an EMPLOYEE actor", async () => {
    const dto = await getEmployee(self.id, scopeActorFor(employeeUser));
    expect(dto.id).toBe(self.id);
    expect(dto.salary).toBeNull(); // stripped, never leaked
    expect(dto.fullName).toBe(`${self.firstName} ${self.lastName}`);
  });

  it("keeps salary for ADMIN on the same record", async () => {
    const dto = await getEmployee(self.id, scopeActorFor(admin));
    expect(dto.salary).toBe("95000.55");
  });

  it("rejects reading ANOTHER employee's record with 403 (before the lookup)", async () => {
    await expectAppError(getEmployee(stranger.id, scopeActorFor(employeeUser)), 403, "FORBIDDEN");
  });

  it("scopes listEmployees to the caller's own row", async () => {
    const page = await listEmployees(
      query(1, 50),
      {},
      byLastName,
      scopeActorFor(employeeUser),
    );
    expect(page.items.map((item) => item.id)).toEqual([self.id]);
    expect(page.total).toBe(1);
  });

  it("denies EMPLOYEE the create action outright", async () => {
    await expectAppError(
      createEmployee(scopeActorFor(employeeUser), createInput(dept.id, uniqueId("x"))),
      403,
      "FORBIDDEN",
    );
  });
});
