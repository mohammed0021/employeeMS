import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guards";
import { employeeScopeFrom } from "@/lib/services/actor";
import { exportCsv } from "@/lib/services/reports";
import { exportKindSchema, reportRangeSchema } from "@/lib/validation/reports";

/**
 * GET /api/reports/export?kind=headcount|attendance|leave|payroll&from=&to=
 * — CSV export (ADMIN/HR per the matrix; EMPLOYEE readOwn never exports).
 *
 * The UTF-8 BOM prefix is what makes Excel decode the file correctly —
 * without it Excel assumes the local code page and mangles non-ASCII names
 * (same rationale as /api/employees/export).
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const session = await requirePermission("reports", "export");
  const params = request.nextUrl.searchParams;
  const kind = exportKindSchema.parse(params.get("kind"));
  const range = reportRangeSchema.parse({
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  });
  const { fileName, csv } = await exportCsv(kind, range, employeeScopeFrom(session));
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
});
