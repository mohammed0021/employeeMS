/**
 * Attrition service — RBAC + audit live here; the risk model itself is loaded
 * through src/lib/ml/attrition.ts.
 *
 * The honest-absence rule: there is no trained model file in this repo (it is
 * produced offline by scripts/train-attrition.py), so `runPredictions` fails
 * with 503 ATTRITION_MODEL_MISSING and the dashboard shows that message.
 * Writing plausible-looking scores from fabricated coefficients would be the
 * worst possible failure mode for data that is about real people's jobs.
 */
import { prisma } from "@/lib/prisma";
import { errors } from "@/lib/errors";
import { can, type Action } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit/audit";
import { offset, paginated, type ListQuery } from "@/lib/pagination";
import { toEmployeeRef, type EmployeeRef } from "@/lib/dto";
import { actorFrom, type Actor } from "@/lib/services/actor";
import {
  computeRisk,
  loadModel,
  riskCategory,
  type AttritionModel,
} from "@/lib/ml/attrition";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { RiskCategory } from "@/generated/prisma/enums";
import type { AttritionFilters, IndicatorUpsertInput } from "@/lib/validation/attrition";

/** Shared actor alias (plain Actor — attrition has no self-scoped view). */
export type AttritionActor = Actor;

export const attritionActorFrom = actorFrom;

/** Matrix check for `resource: "attrition"` — EMPLOYEE holds no actions. */
function assert(actor: AttritionActor, action: Action): void {
  if (!can(actor.role, "attrition", action)) throw errors.forbidden();
}

/** Compact employee ref + department, the only employee data a signal needs. */
const EMPLOYEE_INCLUDE = {
  employee: { include: { department: { select: { id: true, name: true } } } },
} satisfies Prisma.AttritionIndicatorInclude;

type EmployeeRow = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  position: string;
  department: { id: string; name: string } | null;
};

// ─── DTOs ───────────────────────────────────────────────────────────────────

export type AttritionIndicatorDto = {
  id: string;
  employeeId: string;
  overtime: boolean;
  jobSatisfaction: number;
  workLifeBalance: number;
  environmentSatisfaction: number;
  trainingTimesLastYear: number;
  yearsSinceLastPromotion: number;
  employee: EmployeeRef | null;
  updatedAt: string;
};

type IndicatorRow = {
  id: string;
  employeeId: string;
  overtime: boolean;
  jobSatisfaction: number;
  workLifeBalance: number;
  environmentSatisfaction: number;
  trainingTimesLastYear: number;
  yearsSinceLastPromotion: number;
  updatedAt: Date;
  employee: EmployeeRow | null;
};

function toIndicatorDto(row: IndicatorRow): AttritionIndicatorDto {
  return {
    id: row.id,
    employeeId: row.employeeId,
    overtime: row.overtime,
    jobSatisfaction: row.jobSatisfaction,
    workLifeBalance: row.workLifeBalance,
    environmentSatisfaction: row.environmentSatisfaction,
    trainingTimesLastYear: row.trainingTimesLastYear,
    yearsSinceLastPromotion: row.yearsSinceLastPromotion,
    employee: row.employee ? toEmployeeRef(row.employee) : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** JSON columns round-trip through a schema: corrupt JSON yields null. */
const snapshotSchema = z.record(z.string(), z.number());
const factorsSchema = z.array(
  z.object({ feature: z.string(), contribution: z.number() }),
);

export type AttritionSignalDto = {
  id: string;
  employeeId: string;
  employee: EmployeeRef | null;
  riskScore: number;
  riskCategory: RiskCategory;
  inputSnapshot: Record<string, number> | null;
  topFactors: Array<{ feature: string; contribution: number }> | null;
  modelName: string | null;
  modelVersion: string | null;
  partialInputs: boolean;
  generatedAt: string;
};

type SignalRow = {
  id: string;
  employeeId: string;
  riskScore: number;
  riskCategory: RiskCategory;
  inputSnapshot: Prisma.JsonValue | null;
  topFactors: Prisma.JsonValue | null;
  modelName: string | null;
  modelVersion: string | null;
  partialInputs: boolean;
  generatedAt: Date;
  employee: EmployeeRow | null;
};

function toSignalDto(row: SignalRow): AttritionSignalDto {
  const snapshot = snapshotSchema.safeParse(row.inputSnapshot);
  const factors = factorsSchema.safeParse(row.topFactors);
  return {
    id: row.id,
    employeeId: row.employeeId,
    employee: row.employee ? toEmployeeRef(row.employee) : null,
    // Re-rounded on output so the stored number and the API number agree to
    // 4 decimals regardless of which path wrote the row.
    riskScore: Math.round(row.riskScore * 10_000) / 10_000,
    riskCategory: row.riskCategory,
    inputSnapshot: snapshot.success ? snapshot.data : null,
    topFactors: factors.success ? factors.data : null,
    modelName: row.modelName,
    modelVersion: row.modelVersion,
    partialInputs: row.partialInputs,
    generatedAt: row.generatedAt.toISOString(),
  };
}

export type AttritionIndicatorPage = {
  items: AttritionIndicatorDto[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
};

export type AttritionSignalPage = {
  items: AttritionSignalDto[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
};

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * List indicator rows (ADMIN/HR `read` — EMPLOYEE holds no attrition action at
 * all). `category` is ignored here: a category only exists once a prediction
 * run has produced signals, and filtering live indicators by a score they do
 * not have would silently return nothing.
 */
export async function listIndicators(
  query: ListQuery,
  filters: AttritionFilters,
  actor: AttritionActor,
): Promise<AttritionIndicatorPage> {
  assert(actor, "read");

  const where: Prisma.AttritionIndicatorWhereInput = {
    ...(filters.departmentId
      ? { employee: { is: { departmentId: filters.departmentId } } }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.attritionIndicator.findMany({
      where,
      // No sort param: most-recently-updated first is the editing queue order.
      orderBy: { updatedAt: "desc" },
      skip: offset(query),
      take: query.limit,
      include: EMPLOYEE_INCLUDE,
    }),
    prisma.attritionIndicator.count({ where }),
  ]);

  return paginated(rows.map(toIndicatorDto), total, query);
}

/**
 * List risk signals (ADMIN/HR `read`), newest-highest first so the dashboard
 * opens on the employees worth reviewing.
 */
export async function listSignals(
  query: ListQuery,
  filters: AttritionFilters,
  actor: AttritionActor,
): Promise<AttritionSignalPage> {
  assert(actor, "read");

  const where: Prisma.AttritionSignalWhereInput = {
    ...(filters.category ? { riskCategory: filters.category } : {}),
    ...(filters.departmentId
      ? { employee: { is: { departmentId: filters.departmentId } } }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.attritionSignal.findMany({
      where,
      orderBy: [{ riskScore: "desc" }, { id: "asc" }],
      skip: offset(query),
      take: query.limit,
      include: EMPLOYEE_INCLUDE,
    }),
    prisma.attritionSignal.count({ where }),
  ]);

  return paginated(rows.map(toSignalDto), total, query);
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Create/replace an employee's indicator row (ADMIN/HR `update`).
 * The employee must exist — the row is the model's input, and inputs about a
 * phantom employee would poison every later run.
 */
export async function upsertIndicator(
  input: IndicatorUpsertInput,
  actor: AttritionActor,
): Promise<AttritionIndicatorDto> {
  assert(actor, "update");

  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true },
  });
  if (!employee) throw errors.notFound("Employee not found.");

  const row = await prisma.attritionIndicator.upsert({
    where: { employeeId: input.employeeId },
    create: {
      employeeId: input.employeeId,
      overtime: input.overtime,
      jobSatisfaction: input.jobSatisfaction,
      workLifeBalance: input.workLifeBalance,
      environmentSatisfaction: input.environmentSatisfaction,
      trainingTimesLastYear: input.trainingTimesLastYear,
      yearsSinceLastPromotion: input.yearsSinceLastPromotion,
      updatedById: actor.id,
    },
    update: {
      overtime: input.overtime,
      jobSatisfaction: input.jobSatisfaction,
      workLifeBalance: input.workLifeBalance,
      environmentSatisfaction: input.environmentSatisfaction,
      trainingTimesLastYear: input.trainingTimesLastYear,
      yearsSinceLastPromotion: input.yearsSinceLastPromotion,
      updatedById: actor.id,
    },
    include: EMPLOYEE_INCLUDE,
  });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.ATTRITION_INDICATORS_UPDATED,
    entityType: "AttritionIndicator",
    entityId: row.id,
    metadata: { employeeId: input.employeeId },
  });

  return toIndicatorDto(row);
}

// ─── Prediction run ─────────────────────────────────────────────────────────

export type AttritionRunResult = {
  processed: number;
  high: number;
  medium: number;
  low: number;
  model: { name: string; version: string };
};

/**
 * Years between `joinDate` and now, in fractional years — the derived
 * `tenureYears` feature. Clamped at 0 so a future-dated join date can never
 * produce a negative tenure.
 */
function tenureYears(joinDate: Date, now: Date = new Date()): number {
  const years = (now.getTime() - joinDate.getTime()) / (365.25 * 86_400_000);
  return Math.round(Math.max(0, years) * 100) / 100;
}

/**
 * Build the model's input vector for one employee.
 *
 * Every feature the indicator row provides is used as-is; anything else falls
 * back to the training-set default and marks the prediction `partialInputs`,
 * so the dashboard can say "imputed" instead of pretending HR measured it.
 * `tenureYears` is always derived from the join date — a fact about the
 * employee, never imputed.
 */
function resolveInputs(
  model: AttritionModel,
  indicator: {
    overtime: boolean;
    jobSatisfaction: number;
    workLifeBalance: number;
    environmentSatisfaction: number;
    trainingTimesLastYear: number;
    yearsSinceLastPromotion: number;
  } | null,
  joinDate: Date,
): { inputs: Record<string, number>; partialInputs: boolean } {
  const provided: Record<string, number> | null = indicator
    ? {
        overtime: indicator.overtime ? 1 : 0,
        jobSatisfaction: indicator.jobSatisfaction,
        workLifeBalance: indicator.workLifeBalance,
        environmentSatisfaction: indicator.environmentSatisfaction,
        trainingTimesLastYear: indicator.trainingTimesLastYear,
        yearsSinceLastPromotion: indicator.yearsSinceLastPromotion,
      }
    : null;

  const inputs: Record<string, number> = {};
  let partialInputs = false;

  for (const feature of model.features) {
    if (feature === "tenureYears") {
      inputs[feature] = tenureYears(joinDate);
      continue;
    }
    const value = provided !== null && feature in provided ? provided[feature] : undefined;
    if (value !== undefined) {
      inputs[feature] = value;
    } else {
      inputs[feature] = model.defaults[feature];
      partialInputs = true;
    }
  }

  return { inputs, partialInputs };
}

/**
 * Score every ACTIVE employee and upsert their signal (ADMIN/HR `create`).
 *
 * Fails with 503 ATTRITION_MODEL_MISSING when models/attrition-model.json has
 * not been produced — the dashboard surfaces that message verbatim, because
 * "we have no model" is the truthful answer until scripts/train-attrition.py
 * has been run.
 */
export async function runPredictions(actor: AttritionActor): Promise<AttritionRunResult> {
  assert(actor, "create");

  const model = await loadModel();
  if (!model) {
    throw errors.aiUnavailable(
      "ATTRITION_MODEL_MISSING",
      "No trained attrition model found. Train one with scripts/train-attrition.py and place models/attrition-model.json.",
    );
  }

  const employees = await prisma.employee.findMany({
    where: { status: "ACTIVE" },
    include: { attritionIndicator: true },
  });

  const tallies: Record<RiskCategory, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };

  for (const employee of employees) {
    const { inputs, partialInputs } = resolveInputs(
      model,
      employee.attritionIndicator,
      employee.joinDate,
    );
    const { riskScore, topFactors } = computeRisk(model, inputs);
    const category = riskCategory(riskScore, model);

    // employeeId is @unique: one signal per employee, replaced each run.
    await prisma.attritionSignal.upsert({
      where: { employeeId: employee.id },
      create: {
        employeeId: employee.id,
        riskScore,
        riskCategory: category,
        // Exactly the inputs the score was computed from — auditable later.
        inputSnapshot: inputs as unknown as Prisma.InputJsonValue,
        topFactors: topFactors as unknown as Prisma.InputJsonValue,
        modelName: model.modelName,
        modelVersion: model.version,
        partialInputs,
        generatedById: actor.id,
      },
      update: {
        riskScore,
        riskCategory: category,
        inputSnapshot: inputs as unknown as Prisma.InputJsonValue,
        topFactors: topFactors as unknown as Prisma.InputJsonValue,
        modelName: model.modelName,
        modelVersion: model.version,
        partialInputs,
        generatedById: actor.id,
        generatedAt: new Date(),
      },
    });

    tallies[category] += 1;
  }

  const processed = employees.length;

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.ATTRITION_PREDICTED,
    entityType: "AttritionSignal",
    metadata: { processed, high: tallies.HIGH, medium: tallies.MEDIUM, low: tallies.LOW },
  });

  return {
    processed,
    high: tallies.HIGH,
    medium: tallies.MEDIUM,
    low: tallies.LOW,
    model: { name: model.modelName, version: model.version },
  };
}
