import { Metadata } from "next";
import { ModuleShell, PageHeader } from "@/components/layout/page-header";
import { pagePermission } from "@/lib/auth/page-guards";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  await pagePermission("reports", "readOwn");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Attendance, leave, payroll and attrition reports with date filters and CSV export."
      />
      <ModuleShell
        phase="Phase 3 (Core HR)"
        scope="Overview aggregates from real DB records, per-report exports scoped by role (salary exports excluded for EMPLOYEE)."
      />
    </div>
  );
}
