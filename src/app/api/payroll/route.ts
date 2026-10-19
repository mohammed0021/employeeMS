import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guards";
import { parseListQuery, resolveSort } from "@/lib/pagination";
import {
  PAYROLL_SORT_FIELDS,
  createPayroll,
  listPayrolls,
  payrollActorFrom,
  requirePayrollRead,
} from "@/lib/services/payroll";
import { createPayrollSchema, parsePayrollFilters } from "@/lib/validation/payroll";

/** GET /api/payroll — list (ADMIN/HR: all records; EMPLOYEE: own payslips only). */
export const GET = apiHandler(async (request: NextRequest) => {
  const session = await requirePayrollRead();
  const params = request.nextUrl.searchParams;
  const query = parseListQuery(params);
  const filters = parsePayrollFilters(params);
  const sort = resolveSort(params, PAYROLL_SORT_FIELDS, "createdAt");
  return Response.json(
    await listPayrolls(query, filters, sort, payrollActorFrom(session)),
  );
});

/** POST /api/payroll — generate a DRAFT record (ADMIN/HR). */
export const POST = apiHandler(async (request: NextRequest) => {
  const session = await requirePermission("payroll", "create");
  const input = createPayrollSchema.parse(await request.json());
  const record = await createPayroll(payrollActorFrom(session), input);
  return Response.json(record, { status: 201 });
});
