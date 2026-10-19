import { Metadata } from "next";
import { ModuleShell, PageHeader } from "@/components/layout/page-header";
import { pagePermission } from "@/lib/auth/page-guards";

export const metadata: Metadata = { title: "Payslip" };

type Props = { params: Promise<{ id: string }> };

export default async function PayslipPage({ params }: Props) {
  const { id } = await params;
  // Role gate only: ADMIN/HR may open any payslip, EMPLOYEE only their own —
  // the row-level ownership check is enforced in the payroll service (Phase 3).
  await pagePermission("payroll", "readOwn");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payslip"
        description="Itemized base pay, bonuses, deductions and net pay."
      />
      <ModuleShell
        phase="Phase 3 (Core HR)"
        scope={`Print-friendly payslip ${id} with the required "basic academic implementation" disclaimer and row-level ownership check.`}
      />
    </div>
  );
}
