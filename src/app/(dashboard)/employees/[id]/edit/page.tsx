import { Metadata } from "next";
import { ModuleShell, PageHeader } from "@/components/layout/page-header";
import { pagePermission } from "@/lib/auth/page-guards";

export const metadata: Metadata = { title: "Edit employee" };

type Props = { params: Promise<{ id: string }> };

export default async function EditEmployeePage({ params }: Props) {
  const { id } = await params;
  await pagePermission("employees", "update");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit employee"
        description="Update record fields; changes are validated and audit-logged."
      />
      <ModuleShell
        phase="Phase 3 (Core HR)"
        scope={`Edit form for employee ${id} with partial update, duplicate-code protection, and change auditing.`}
      />
    </div>
  );
}
