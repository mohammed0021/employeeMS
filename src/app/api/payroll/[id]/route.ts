import { NextRequest } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guards";
import {
  getPayroll,
  modifyPayroll,
  payrollActorFrom,
  requirePayrollRead,
} from "@/lib/services/payroll";
import { modifyPayrollSchema } from "@/lib/validation/payroll";

type Params = { params: Promise<{ id: string }> };

/** GET /api/payroll/:id — ADMIN/HR any record; EMPLOYEE their own payslip. */
export const GET = apiHandler(async (_request: NextRequest, ctx: Params) => {
  const session = await requirePayrollRead();
  const { id } = await ctx.params;
  return Response.json(await getPayroll(id, payrollActorFrom(session)));
});

/** PATCH /api/payroll/:id — `{ update: {…} }` while DRAFT, or `{ finalize: true }`. */
export const PATCH = apiHandler(async (request: NextRequest, ctx: Params) => {
  const session = await requirePermission("payroll", "update");
  const { id } = await ctx.params;
  const input = modifyPayrollSchema.parse(await request.json());
  return Response.json(await modifyPayroll(payrollActorFrom(session), id, input));
});
