/**
 * Attrition: indicator upserts and the honest-failure contract of
 * `runPredictions` — with no trained model file it must fail 503 and create
 * NO signals, rather than fabricating plausible-looking risk scores.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { runPredictions, upsertIndicator } from "@/lib/services/attrition";
import type { IndicatorUpsertInput } from "@/lib/validation/attrition";
import {
  actorFor,
  expectAppError,
  makeDept,
  makeEmployee,
  makeUser,
  runCleanups,
  type DeptFixture,
  type EmployeeFixture,
  type UserFixture,
} from "./helpers";

/** Offline training artifact — absence is the documented default state. */
const MODEL_FILE = path.join(process.cwd(), "models", "attrition-model.json");

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

function indicator(employeeId: string, overrides: Partial<IndicatorUpsertInput> = {}): IndicatorUpsertInput {
  return {
    employeeId,
    overtime: true,
    jobSatisfaction: 2,
    workLifeBalance: 2,
    environmentSatisfaction: 3,
    trainingTimesLastYear: 1,
    yearsSinceLastPromotion: 4,
    ...overrides,
  };
}

describe("upsertIndicator", () => {
  it("creates then replaces the employee's single indicator row", async () => {
    const first = await upsertIndicator(indicator(employee.id), actorFor(admin));
    expect(first.employeeId).toBe(employee.id);
    expect(first.jobSatisfaction).toBe(2);
    expect(first.overtime).toBe(true);
    expect(first.updatedAt).toBeTruthy();

    const second = await upsertIndicator(
      indicator(employee.id, { jobSatisfaction: 4, overtime: false, yearsSinceLastPromotion: 1 }),
      actorFor(admin),
    );
    expect(second.id).toBe(first.id); // upsert, not a second row
    expect(second.jobSatisfaction).toBe(4);
    expect(second.overtime).toBe(false);

    expect(await prisma.attritionIndicator.count({ where: { employeeId: employee.id } })).toBe(1);
  });

  it("404s for an employee that does not exist", async () => {
    await expectAppError(
      upsertIndicator(indicator("ghost-employee"), actorFor(admin)),
      404,
      "NOT_FOUND",
    );
  });

  it("denies EMPLOYEE with 403 (attrition/EMPLOYEE holds no actions)", async () => {
    await expectAppError(
      upsertIndicator(indicator(employee.id), actorFor(employeeUser)),
      403,
      "FORBIDDEN",
    );
  });
});

describe("runPredictions", () => {
  it("fails honestly with 503 ATTRITION_MODEL_MISSING and fabricates nothing", async () => {
    const signalsBefore = await prisma.attritionSignal.count();

    if (fs.existsSync(MODEL_FILE)) {
      // Model artifact present (e.g. after scripts/train-attrition.py): the run
      // must go through and score the ACTIVE fixture employees.
      const result = await runPredictions(actorFor(admin));
      expect(result.processed).toBeGreaterThan(0);
      expect(result.low + result.medium + result.high).toBe(result.processed);
      expect(result.model.name).toBeTruthy();
      return;
    }

    const error = await expectAppError(
      runPredictions(actorFor(admin)),
      503,
      "ATTRITION_MODEL_MISSING",
    );
    expect(error.message).toMatch(/train-attrition\.py/i);

    // Honest failure = zero writes: no rows for our employee, none anywhere.
    expect(await prisma.attritionSignal.count({ where: { employeeId: employee.id } })).toBe(0);
    expect(await prisma.attritionSignal.count()).toBe(signalsBefore);
  });

  it("denies EMPLOYEE runs with 403", async () => {
    await expectAppError(runPredictions(actorFor(employeeUser)), 403, "FORBIDDEN");
  });
});
