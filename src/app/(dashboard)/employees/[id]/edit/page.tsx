import { Metadata } from "next";

import { EmployeeForm, type DepartmentOption } from "@/components/employees/employee-actions";
import { PageHeader } from "@/components/layout/page-header";
import { canSeeSalary, type DepartmentDto } from "@/lib/dto";
import { pagePermission, pageService } from "@/lib/auth/page-guards";
import { can } from "@/lib/auth/permissions";
import { employeeScopeFrom } from "@/lib/services/actor";
import { getEmployee } from "@/lib/services/employees";
import { listDepartments } from "@/lib/services/departments";

export const metadata: Metadata = { title: "Edit employee" };

type Props = { params: Promise<{ id: string }> };

export default async function EditEmployeePage({ params }: Props) {
  const { id } = await params;
  const session = await pagePermission("employees", "update");
  const { role } = session.user;
  const actor = employeeScopeFrom(session);

  // getEmployee enforces readOwn scoping and throws AppError(404) for an
  // unknown id, so an empty form never renders for a record that doesn't
  // exist; pageService() maps that throw onto the 404 page instead of a 500.
  const employee = await pageService(() => getEmployee(id, actor));

  // Same fetch the list page uses, so the department <select> options match.
  const departments: DepartmentDto[] = can(role, "departments", "read")
    ? (await listDepartments({ page: 1, limit: 100, q: undefined }, actor)).items
    : [];

  const options: DepartmentOption[] = departments.map((d) => ({
    id: d.id,
    name: d.name,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit ${employee.fullName}`}
        description="Update record fields; changes are validated and audit-logged."
      />
      <EmployeeForm
        employee={employee}
        departments={options}
        showSalary={canSeeSalary(role)}
      />
    </div>
  );
}
