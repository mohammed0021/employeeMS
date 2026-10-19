import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guards";
import { parseListQuery } from "@/lib/pagination";
import { actorFrom } from "@/lib/services/actor";
import { listAuditLogs } from "@/lib/services/audit-log";
import { auditLogFilterSchema } from "@/lib/validation/admin";

/**
 * GET /api/audit — filtered, paginated audit trail (ADMIN read per the matrix).
 *
 * Read-only on purpose: the table is append-only and there is no
 * update/delete route anywhere — an editable audit log is not evidence.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const session = await requirePermission("audit", "read");
  const params = request.nextUrl.searchParams;
  const query = parseListQuery(params);
  const filters = auditLogFilterSchema.parse({
    action: params.get("action") ?? undefined,
    entityType: params.get("entityType") ?? undefined,
    entityId: params.get("entityId") ?? undefined,
    actorId: params.get("actorId") ?? undefined,
    outcome: params.get("outcome") ?? undefined,
    dateFrom: params.get("dateFrom") ?? undefined,
    dateTo: params.get("dateTo") ?? undefined,
  });
  return Response.json(await listAuditLogs(query, filters, actorFrom(session)));
});
