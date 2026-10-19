import { Metadata } from "next";
import { ModuleShell, PageHeader } from "@/components/layout/page-header";
import { pagePermission } from "@/lib/auth/page-guards";

export const metadata: Metadata = { title: "Payroll" };

export default async function PayrollPage() {
  await pagePermission("payroll", "readOwn");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        description="Basic academic payroll: net = base + bonuses − deductions (decimal-safe)."
      />
      <ModuleShell
        phase="Phase 3 (Core HR)"
        scope="Period generation, bonus/deduction editing while DRAFT, finalize lock, audit trail, export. Employees see only their own payslips."
      />
    </div>
  );
}
