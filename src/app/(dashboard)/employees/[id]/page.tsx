import { Metadata } from "next";
import { ModuleShell, PageHeader } from "@/components/layout/page-header";
import { pagePermission } from "@/lib/auth/page-guards";

export const metadata: Metadata = { title: "Employee profile" };

type Props = { params: Promise<{ id: string }> };

export default async function EmployeeDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await pagePermission("employees", "read");

  // EMPLOYEE holds only readOwn: they may open exactly their own profile.
  if (session.user.role === "EMPLOYEE" && session.user.employeeId !== id) {
    const { forbidden } = await import("next/navigation");
    forbidden();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employee profile"
        description="Structured profile with attendance, leave, payroll and feedback tabs."
      />
      <ModuleShell
        phase="Phase 3 (Core HR)"
        scope={`Profile view for record ${id} with role-scoped tabs (salary visible to ADMIN/HR and the owner only).`}
      />
    </div>
  );
}
