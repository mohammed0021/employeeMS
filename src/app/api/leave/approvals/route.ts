import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guards";
import { parseListQuery } from "@/lib/pagination";
import { leaveActorFrom, listPendingApprovals } from "@/lib/services/leave";

/** GET /api/leave/approvals — PENDING approval queue (ADMIN/HR). */
export const GET = apiHandler(async (request: NextRequest) => {
  const session = await requirePermission("leave", "approve");
  const query = parseListQuery(request.nextUrl.searchParams);
  return Response.json(await listPendingApprovals(query, leaveActorFrom(session)));
});
