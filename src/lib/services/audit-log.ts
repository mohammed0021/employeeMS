/**
 * Audit log query service — READ-ONLY.
 *
 * The audit table is append-only by design: `recordAudit` in
 * src/lib/audit/audit.ts is the ONLY writer, and there is deliberately no
 * update/delete counterpart anywhere in the codebase. An audit trail that
 * its own admins can edit stops being evidence the moment a compromised
 * admin account can cover its tracks — tamper resistance is the whole point.
 * This module therefore exposes exactly one operation: a filtered,
 * paginated, newest-first read, gated to ADMIN (the matrix grants `audit`
 * read to ADMIN only).
 *
 * `metadata` passes through as-is: write-time sanitisation in the audit
 * writer already strips password/token/secret-shaped keys before they ever
 * reach the database, so re-filtering here would only hide what auditors
 * need to see.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { AuditOutcome } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { errors } from "@/lib/errors";
import { offset, paginated, type ListQuery } from "@/lib/pagination";
import type { Actor } from "@/lib/services/actor";
import type { AuditLogFilters } from "@/lib/validation/admin";

/** ADMIN-only read — mirrors `requirePermission("audit", "read")` in the service. */
function assertAdmin(actor: Actor): void {
  if (actor.role !== "ADMIN") throw errors.forbidden();
}

export type AuditLogDto = {
  id: string;
  actor: { id: string; email: string; role: string | null } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  outcome: AuditOutcome;
  metadata: Prisma.JsonValue;
  createdAt: string;
};

/** `actorRole` is the role AT THE TIME of the action — the interesting value. */
type AuditRow = Prisma.AuditLogGetPayload<{
  include: { actor: { select: { id: true; email: true; role: true } } };
}>;

function toAuditLogDto(row: AuditRow): AuditLogDto {
  return {
    id: row.id,
    actor: row.actor
      ? { id: row.actor.id, email: row.actor.email, role: row.actorRole }
      : null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    outcome: row.outcome,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

/** `@db`-free timestamp column: inclusive `to` day means "< next midnight". */
function startOfUtcDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export type AuditLogPage = {
  items: AuditLogDto[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
};

/**
 * Paginated, newest-first audit trail (ADMIN only).
 *
 * Filters narrow by action, entity, acting user, outcome and a UTC date
 * range on `createdAt`. All are exact-match (or inclusive date bounds)
 * against validated input — no free-form ordering or projection is ever
 * built from the query, so nothing here can reach Prisma unvalidated.
 */
export async function listAuditLogs(
  query: ListQuery,
  filters: AuditLogFilters,
  actor: Actor,
): Promise<AuditLogPage> {
  assertAdmin(actor);

  const where: Prisma.AuditLogWhereInput = {};
  if (filters.action) where.action = filters.action;
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.entityId) where.entityId = filters.entityId;
  if (filters.actorId) where.actorId = filters.actorId;
  if (filters.outcome) where.outcome = filters.outcome;
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom ? { gte: startOfUtcDay(filters.dateFrom) } : {}),
      ...(filters.dateTo
        ? { lt: new Date(startOfUtcDay(filters.dateTo).getTime() + 86_400_000) }
        : {}),
    };
  }

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      // Newest first — the default reading order for an investigation.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: offset(query),
      take: query.limit,
      include: { actor: { select: { id: true, email: true, role: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return paginated(rows.map(toAuditLogDto), total, query);
}
