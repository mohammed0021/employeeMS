import { Metadata } from "next";
import { ModuleShell, PageHeader } from "@/components/layout/page-header";
import { pagePermission } from "@/lib/auth/page-guards";

export const metadata: Metadata = { title: "Employees" };

export default async function EmployeesPage() {
  await pagePermission("employees", "read");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employee directory"
        description="Search, filter and manage employee records."
      />
      <ModuleShell
        phase="Phase 3 (Core HR)"
        scope="Directory table with search/sort/pagination, create & edit forms, deactivation, and CSV export — permission-guarded now, data wired in Phase 3."
      />
    </div>
  );
}
