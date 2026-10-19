import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guards";
import { exportPayrolls, payrollActorFrom } from "@/lib/services/payroll";
import { parsePayrollFilters } from "@/lib/validation/payroll";

/**
 * GET /api/payroll/export — CSV of every record matching the same month/year/
 * employeeId/status filters as the list endpoint (ADMIN/HR only). The UTF-8 BOM
 * prefix makes Excel parse the file as UTF-8.
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const session = await requirePermission("payroll", "export");
  const filters = parsePayrollFilters(request.nextUrl.searchParams);
  const csv = await exportPayrolls(payrollActorFrom(session), filters);
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="payroll.csv"',
    },
  });
});
