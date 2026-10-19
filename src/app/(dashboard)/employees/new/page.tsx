import { Metadata } from "next";
import { ModuleShell, PageHeader } from "@/components/layout/page-header";
import { pagePermission } from "@/lib/auth/page-guards";

export const metadata: Metadata = { title: "New employee" };

export default async function NewEmployeePage() {
  await pagePermission("employees", "create");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Add employee"
        description="Create a new employee record with validation and duplicate checks."
      />
      <ModuleShell
        phase="Phase 3 (Core HR)"
        scope="Validated create form (React Hook Form + Zod), department linking, optional account creation, audit entry."
      />
    </div>
  );
}
