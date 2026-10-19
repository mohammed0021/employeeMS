/**
 * Performance-feedback service — RBAC + the DRAFT → AI_DRAFT → FINALIZED
 * state machine + audit live here, not in the route handlers (same contract as
 * services/leave.ts: PERMISSIONS.md says enforcement happens "in services, not
 * just this matrix", so every entry point is covered even if a caller forgets
 * its route-level `requirePermission()` check).
 *
 * Two hard rules live in this file:
 *  - An EMPLOYEE reads only their own feedback (`readOwn`), and the scope is
 *    fixed server-side from the session — never from query params.
 *  - FINALIZED is immutable. A finalized review is the record of what an
 *    employee was told; letting it be edited afterwards would make the audit
 *    trail a lie.
 */
import { prisma } from "@/lib/prisma";
import { errors } from "@/lib/errors";
import { can, type Action } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit/audit";
import { offset, paginated, type ListQuery } from "@/lib/pagination";
import { callAi } from "@/lib/ai/provider";
import { employeeScopeFrom, type EmployeeScopeActor } from "@/lib/services/actor";
import {
  feedbackIndicatorsSchema,
  type ApproveFeedbackInput,
  type CreateFeedbackInput,
  type FeedbackFilters,
  type FeedbackIndicators,
  type FeedbackSort,
  type UpdateFeedbackInput,
} from "@/lib/validation/feedback";
import type { Prisma } from "@/generated/prisma/client";
import type { FeedbackStatus } from "@/generated/prisma/enums";

/** Shared actor alias (see services/actor.ts — single source of employeeId). */
export type FeedbackActor = EmployeeScopeActor;

export const feedbackActorFrom = employeeScopeFrom;

type FeedbackAction = Action;

/** Matrix check for `resource: "feedback"` — the service re-checks the route. */
function assert(actor: FeedbackActor, action: FeedbackAction): void {
  if (!can(actor.role, "feedback", action)) throw errors.forbidden();
}

/**
 * Embedded refs for the DTO. The department name is included because the AI
 * draft prompt describes the employee by position + department (never by name
 * or salary); it is not echoed into the DTO.
 */
const FEEDBACK_INCLUDE = {
  employee: {
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      position: true,
      department: { select: { name: true } },
    },
  },
  reviewer: { select: { id: true, email: true } },
} satisfies Prisma.PerformanceFeedbackInclude;

type FeedbackEmployeeRow = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  position: string;
  department: { name: string } | null;
};

type FeedbackRow = {
  id: string;
  employeeId: string;
  reviewerId: string;
  cycleLabel: string;
  indicators: Prisma.JsonValue;
  aiDraft: string | null;
  finalText: string | null;
  status: FeedbackStatus;
  aiModel: string | null;
  generatedAt: Date | null;
  finalizedById: string | null;
  finalizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  employee: FeedbackEmployeeRow | null;
  reviewer: { id: string; email: string } | null;
};

export type FeedbackDto = {
  id: string;
  employeeId: string;
  employee: { id: string; employeeCode: string; fullName: string; position: string } | null;
  reviewer: { id: string; email: string } | null;
  cycleLabel: string;
  /** Parsed structured ratings; null only if a stored row predates this schema. */
  indicators: FeedbackIndicators | null;
  aiDraft: string | null;
  finalText: string | null;
  status: FeedbackStatus;
  aiModel: string | null;
  generatedAt: string | null;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Row → DTO.
 *
 * The reviewer is dropped entirely for EMPLOYEE viewers: which internal
 * account wrote the review is bookkeeping the subject need not know, and the
 * mapper takes the actor precisely so that field-level redaction cannot be
 * forgotten by a caller. The rating object is re-validated instead of cast —
 * if a stored row somehow fails the schema, null is honest; inventing a
 * default rating set would put words in the reviewer's mouth.
 */
function toFeedbackDto(row: FeedbackRow, actor: FeedbackActor): FeedbackDto {
  const parsed = feedbackIndicatorsSchema.safeParse(row.indicators);
  return {
    id: row.id,
    employeeId: row.employeeId,
    employee: row.employee
      ? {
          id: row.employee.id,
          employeeCode: row.employee.employeeCode,
          fullName: `${row.employee.firstName} ${row.employee.lastName}`.trim(),
          position: row.employee.position,
        }
      : null,
    reviewer: can(actor.role, "feedback", "read") ? row.reviewer : null,
    cycleLabel: row.cycleLabel,
    indicators: parsed.success ? parsed.data : null,
    aiDraft: row.aiDraft,
    finalText: row.finalText,
    status: row.status,
    aiModel: row.aiModel,
    generatedAt: row.generatedAt?.toISOString() ?? null,
    finalizedAt: row.finalizedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type FeedbackPage = {
  items: FeedbackDto[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
};

function orderByFor(sort: FeedbackSort): Prisma.PerformanceFeedbackOrderByWithRelationInput {
  switch (sort.field) {
    case "updatedAt":
      return { updatedAt: sort.dir };
    case "cycleLabel":
      return { cycleLabel: sort.dir };
    case "status":
      return { status: sort.dir };
    default:
      return { createdAt: sort.dir };
  }
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * List feedback. ADMIN/HR (`read`) get org-wide rows plus the employeeId and
 * status filters; EMPLOYEE (`readOwn`) get exactly their own rows and the
 * incoming filters are DROPPED rather than merged — the caller's scope is a
 * fact about the session, never something a query string may rewrite, and
 * ignoring today's narrow-looking filter is what keeps tomorrow's new filter
 * from becoming a widening bypass.
 */
export async function listFeedback(
  query: ListQuery,
  filters: FeedbackFilters,
  sort: FeedbackSort,
  actor: FeedbackActor,
): Promise<FeedbackPage> {
  const canSeeAll = can(actor.role, "feedback", "read");
  if (!canSeeAll && !can(actor.role, "feedback", "readOwn")) throw errors.forbidden();

  const search: Prisma.PerformanceFeedbackWhereInput = query.q
    ? {
        OR: [
          { cycleLabel: { contains: query.q, mode: "insensitive" } },
          {
            employee: {
              is: {
                OR: [
                  { firstName: { contains: query.q, mode: "insensitive" } },
                  { lastName: { contains: query.q, mode: "insensitive" } },
                ],
              },
            },
          },
        ],
      }
    : {};

  let where: Prisma.PerformanceFeedbackWhereInput;
  if (canSeeAll) {
    where = {
      ...search,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
    };
  } else if (actor.employeeId !== null) {
    // readOwn scope is fixed: no status/employeeId filter is honoured here.
    where = { ...search, employeeId: actor.employeeId };
  } else {
    // readOwn but no linked employee → nothing can belong to them.
    return paginated<FeedbackDto>([], 0, query);
  }

  const [rows, total] = await Promise.all([
    prisma.performanceFeedback.findMany({
      where,
      orderBy: orderByFor(sort),
      skip: offset(query),
      take: query.limit,
      include: FEEDBACK_INCLUDE,
    }),
    prisma.performanceFeedback.count({ where }),
  ]);

  return paginated(
    rows.map((row) => toFeedbackDto(row, actor)),
    total,
    query,
  );
}

/**
 * Read one feedback row. An EMPLOYEE pointing at someone else's feedback is
 * FORBIDDEN — checked before the not-found branch so the response never
 * depends on which side of the lookup fails first; ADMIN/HR (`read`) may read
 * any row.
 */
export async function getFeedback(id: string, actor: FeedbackActor): Promise<FeedbackDto> {
  const canReadAll = can(actor.role, "feedback", "read");
  if (!canReadAll && !can(actor.role, "feedback", "readOwn")) throw errors.forbidden();
  if (!canReadAll && actor.employeeId === null) {
    throw errors.forbidden("Your account is not linked to an employee profile.");
  }

  const row = await prisma.performanceFeedback.findUnique({
    where: { id },
    include: FEEDBACK_INCLUDE,
  });
  if (row && !canReadAll && row.employeeId !== actor.employeeId) {
    throw errors.forbidden();
  }
  if (!row) throw errors.notFound("Feedback not found.");
  return toFeedbackDto(row, actor);
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/** Create a DRAFT review. ADMIN/HR only; EMPLOYEE holds no create here. */
export async function createFeedback(
  input: CreateFeedbackInput,
  actor: FeedbackActor,
): Promise<FeedbackDto> {
  assert(actor, "create");

  // Clear 404 before Prisma's FK error: the client is told which lookup failed.
  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true },
  });
  if (!employee) throw errors.notFound("Employee not found.");

  const row = await prisma.performanceFeedback.create({
    data: {
      employeeId: input.employeeId,
      // The reviewer is the acting user — never a value from the body.
      reviewerId: actor.id,
      cycleLabel: input.cycleLabel,
      indicators: input.indicators as unknown as Prisma.InputJsonValue,
      // status defaults to DRAFT in the schema.
    },
    include: FEEDBACK_INCLUDE,
  });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.FEEDBACK_CREATED,
    entityType: "PerformanceFeedback",
    entityId: row.id,
    metadata: {
      feedbackId: row.id,
      employeeId: input.employeeId,
      cycleLabel: input.cycleLabel,
    },
  });

  return toFeedbackDto(row, actor);
}

/**
 * Edit a draft (indicators and/or final text). FINALIZED rows are immutable —
 * a 409 rather than a silent no-op, so the caller learns the review has been
 * published.
 */
export async function updateFeedback(
  id: string,
  input: UpdateFeedbackInput,
  actor: FeedbackActor,
): Promise<FeedbackDto> {
  assert(actor, "update");

  const existing = await prisma.performanceFeedback.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!existing) throw errors.notFound("Feedback not found.");
  if (existing.status === "FINALIZED") {
    throw errors.conflict("Finalized feedback cannot be edited.");
  }

  const data: Prisma.PerformanceFeedbackUpdateInput = {};
  const fields: string[] = [];
  if (input.finalText !== undefined) {
    data.finalText = input.finalText;
    fields.push("finalText");
  }
  if (input.indicators !== undefined) {
    data.indicators = input.indicators as unknown as Prisma.InputJsonValue;
    fields.push("indicators");
  }

  const row = await prisma.performanceFeedback.update({
    where: { id },
    data,
    include: FEEDBACK_INCLUDE,
  });

  // AUDIT_ACTIONS has no FEEDBACK_UPDATED key yet, and audit.action is a free
  // string — the literal keeps this file honest instead of misusing another
  // action name.
  await recordAudit({
    actor,
    action: "FEEDBACK_UPDATED",
    entityType: "PerformanceFeedback",
    entityId: id,
    metadata: { fields },
  });

  return toFeedbackDto(row, actor);
}

/**
 * Generate an AI draft for an existing review (ADMIN/HR only).
 *
 * The prompt carries position + department, never the employee's name or
 * salary: identity and pay are irrelevant to performance prose and would only
 * give the model something to anchor on. `callAi` throws 503 (unconfigured)
 * or 429 (budget) and those AppErrors propagate — an honest failure, never an
 * invented draft.
 */
export async function generateAiDraft(
  id: string,
  actor: FeedbackActor,
): Promise<FeedbackDto> {
  assert(actor, "update");

  const existing = await prisma.performanceFeedback.findUnique({
    where: { id },
    include: FEEDBACK_INCLUDE,
  });
  if (!existing) throw errors.notFound("Feedback not found.");
  if (existing.status === "FINALIZED") {
    throw errors.conflict("Finalized feedback cannot be edited.");
  }

  const indicators = feedbackIndicatorsSchema.parse(existing.indicators);
  const employee = existing.employee;
  if (!employee) throw errors.notFound("Employee not found.");

  const system =
    "You draft an annual performance review paragraph for an HR reviewer to " +
    "edit. Use ONLY the structured indicators supplied. Be specific and " +
    "professional, under 180 words. Do not invent projects, dates or events.";

  const user = [
    `Review cycle: ${existing.cycleLabel}`,
    `Employee position and department: ${employee.position} (${employee.department?.name ?? "unassigned"})`,
    "Structured indicators (each rated 1-5):",
    `- communication: ${indicators.communication}/5`,
    `- quality of work: ${indicators.qualityOfWork}/5`,
    `- productivity: ${indicators.productivity}/5`,
    `- teamwork: ${indicators.teamwork}/5`,
    `- reliability: ${indicators.reliability}/5`,
    indicators.strengths ? `Strengths noted by the reviewer: ${indicators.strengths}` : null,
    indicators.improvementAreas
      ? `Areas for improvement noted by the reviewer: ${indicators.improvementAreas}`
      : null,
    "Draft the review paragraph now.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const result = await callAi({
    actorId: actor.id,
    purpose: "FEEDBACK",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const row = await prisma.performanceFeedback.update({
    where: { id },
    data: {
      aiDraft: result.text,
      aiModel: result.model,
      generatedAt: new Date(),
      status: "AI_DRAFT",
    },
    include: FEEDBACK_INCLUDE,
  });

  return toFeedbackDto(row, actor);
}

/**
 * Finalize: a human writes/approves the final text, status becomes
 * FINALIZED and the row is thereafter immutable (see updateFeedback).
 * An empty `finalText` is a 400 — the AI draft alone can never become the
 * official review.
 */
export async function approveFeedback(
  id: string,
  input: ApproveFeedbackInput,
  actor: FeedbackActor,
): Promise<FeedbackDto> {
  assert(actor, "approve");

  const existing = await prisma.performanceFeedback.findUnique({
    where: { id },
    select: { id: true, status: true, employeeId: true },
  });
  if (!existing) throw errors.notFound("Feedback not found.");
  if (existing.status === "FINALIZED") {
    throw errors.conflict("Feedback is already finalized.");
  }

  const finalText = input.finalText.trim();
  if (finalText.length === 0) {
    throw errors.validation("Final text is required to finalize feedback.");
  }

  const row = await prisma.performanceFeedback.update({
    where: { id },
    data: {
      finalText,
      status: "FINALIZED",
      finalizedById: actor.id,
      finalizedAt: new Date(),
    },
    include: FEEDBACK_INCLUDE,
  });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.FEEDBACK_FINALIZED,
    entityType: "PerformanceFeedback",
    entityId: id,
    metadata: { feedbackId: id, employeeId: existing.employeeId },
  });

  return toFeedbackDto(row, actor);
}
