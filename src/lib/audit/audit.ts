import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { AuditOutcome } from "@/generated/prisma/enums";

/**
 * Append-only audit writer. Reused by every module.
 *
 * Rules:
 *  - Never pass passwords, tokens, API keys or unrelated salaries in metadata.
 *  - There is no update/delete counterpart anywhere in the codebase.
 *  - Failures are logged, never thrown: auditing must not break the request.
 */
export type AuditActor = {
  id: string;
  role: string;
} | null;

export type AuditEntry = {
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId?: string | null;
  outcome?: AuditOutcome;
  metadata?: Record<string, unknown>;
};

/** Keys that must never appear in audit metadata (defense in depth). */
const FORBIDDEN_KEYS = /password|token|secret|apikey|api_key|authorization|hash/i;

function sanitize(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_KEYS.test(key)) continue;
    out[key] = value;
  }
  return out;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const metadata = sanitize(entry.metadata);
    await prisma.auditLog.create({
      data: {
        actorId: entry.actor?.id ?? null,
        actorRole: entry.actor?.role ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        outcome: entry.outcome ?? "SUCCESS",
        // Plain objects are valid JSON input; cast satisfies Prisma's union.
        ...(metadata
          ? { metadata: metadata as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
  } catch (error) {
    // Observability without breaking the user's operation.
    console.error("[audit] failed to record:", entry.action, error);
  }
}

/** Canonical action names (avoid typos across modules). */
export const AUDIT_ACTIONS = {
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  LOGIN_FAILURE: "LOGIN_FAILURE",
  LOGOUT: "LOGOUT",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  USER_CREATED: "USER_CREATED",
  USER_UPDATED: "USER_UPDATED",
  USER_ROLE_CHANGE: "USER_ROLE_CHANGE",
  SELF_ROLE_CHANGE_DENIED: "SELF_ROLE_CHANGE_DENIED",
  EMPLOYEE_CREATED: "EMPLOYEE_CREATED",
  EMPLOYEE_UPDATED: "EMPLOYEE_UPDATED",
  EMPLOYEE_DEACTIVATED: "EMPLOYEE_DEACTIVATED",
  EMPLOYEE_DELETED: "EMPLOYEE_DELETED",
  DEPARTMENT_CREATED: "DEPARTMENT_CREATED",
  DEPARTMENT_UPDATED: "DEPARTMENT_UPDATED",
  DEPARTMENT_DELETED: "DEPARTMENT_DELETED",
  ATTENDANCE_RECORDED: "ATTENDANCE_RECORDED",
  ATTENDANCE_CORRECTED: "ATTENDANCE_CORRECTED",
  LEAVE_SUBMITTED: "LEAVE_SUBMITTED",
  LEAVE_DECIDED: "LEAVE_DECIDED",
  LEAVE_CANCELLED: "LEAVE_CANCELLED",
  PAYROLL_GENERATED: "PAYROLL_GENERATED",
  PAYROLL_MODIFIED: "PAYROLL_MODIFIED",
  PAYROLL_FINALIZED: "PAYROLL_FINALIZED",
  POLICY_UPLOADED: "POLICY_UPLOADED",
  POLICY_DELETED: "POLICY_DELETED",
  FEEDBACK_CREATED: "FEEDBACK_CREATED",
  FEEDBACK_FINALIZED: "FEEDBACK_FINALIZED",
  ATTRITION_PREDICTED: "ATTRITION_PREDICTED",
  ATTRITION_INDICATORS_UPDATED: "ATTRITION_INDICATORS_UPDATED",
} as const;
