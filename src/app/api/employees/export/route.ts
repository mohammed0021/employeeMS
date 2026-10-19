import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guards";
import { parseListQuery } from "@/lib/pagination";
import { employeeActorFrom, exportEmployeesCsv } from "@/lib/services/employees";
import { employeeFilterSchema } from "@/lib/validation/employees";

/**
 * GET /api/employees/export — CSV export (ADMIN/HR per the matrix).
 *
 * Same q/departmentId/status filters as the list, but every matching row
 * (no pagination). The UTF-8 BOM prefix is what makes Excel decode the file
 * correctly — without it Excel assumes the local code page and mangles
 * non-ASCII names.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const session = await requirePermission("employees", "export");
  const params = request.nextUrl.searchParams;
  const { q } = parseListQuery(params);
  const filters = employeeFilterSchema.parse({
    q,
    departmentId: params.get("departmentId"),
    status: params.get("status"),
  });
  const csv = await exportEmployeesCsv(employeeActorFrom(session), filters);
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="employees.csv"',
    },
  });
});
