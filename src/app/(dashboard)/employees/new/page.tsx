import { Metadata } from "next";

import { EmployeeForm, type DepartmentOption } from "@/components/employees/employee-actions";
import { PageHeader } from "@/components/layout/page-header";
import { canSeeSalary, type DepartmentDto } from "@/lib/dto";
import { pagePermission } from "@/lib/auth/page-guards";
import { can } from "@/lib/auth/permissions";
import { employeeScopeFrom } from "@/lib/services/actor";
import { listDepartments } from "@/lib/services/departments";

export const metadata: Metadata = { title: "New employee" };

export default async function NewEmployeePage() {
  const session = await pagePermission("employees", "create");
  const { role } = session.user;

  // Same fetch the list page uses, so the department <select> options match.
  const departments: DepartmentDto[] = can(role, "departments", "read")
    ? (await listDepartments({ page: 1, limit: 100, q: undefined }, employeeScopeFrom(session)))
        .items
    : [];

  const options: DepartmentOption[] = departments.map((d) => ({
    id: d.id,
    name: d.name,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Add employee"
        description="Create a new employee record with validation and duplicate checks."
      />
      {/* Create is ADMIN/HR only, so salary is always shown here. */}
      <EmployeeForm departments={options} showSalary={canSeeSalary(role)} />
    </div>
  );
}
