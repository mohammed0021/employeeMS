import { Metadata } from "next";
import { ModuleShell, PageHeader } from "@/components/layout/page-header";
import { pagePermission } from "@/lib/auth/page-guards";

export const metadata: Metadata = { title: "Departments" };

export default async function DepartmentsPage() {
  await pagePermission("departments", "read");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Departments"
        description="Organizational units with employee counts."
      />
      <ModuleShell
        phase="Phase 3 (Core HR)"
        scope="CRUD for ADMIN, read-only for HR/Employee; delete blocked while the department still has employees."
      />
    </div>
  );
}
