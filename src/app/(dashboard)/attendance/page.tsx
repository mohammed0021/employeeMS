import { Metadata } from "next";
import { ModuleShell, PageHeader } from "@/components/layout/page-header";
import { pagePermission } from "@/lib/auth/page-guards";

export const metadata: Metadata = { title: "Attendance" };

export default async function AttendancePage() {
  await pagePermission("attendance", "readOwn");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Daily records, summaries and corrections. Employees see their own history."
      />
      <ModuleShell
        phase="Phase 3 (Core HR)"
        scope="Manual entry grid (ADMIN/HR) with duplicate detection, date/time validation, filters by employee/department/date range, summaries and CSV report."
      />
    </div>
  );
}
