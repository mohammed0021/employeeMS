import { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { PaginationNav, SearchForm } from "@/components/layout/list-controls";
import { pagePermission } from "@/lib/auth/page-guards";
import { actorFrom } from "@/lib/services/actor";
import { listDepartments } from "@/lib/services/departments";
import { parseListQuery, toUrlSearchParams } from "@/lib/pagination";
import { can } from "@/lib/auth/permissions";
import {
  DepartmentRowActions,
  NewDepartmentButton,
} from "@/components/departments/department-actions";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = { title: "Departments" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DepartmentsPage({ searchParams }: PageProps) {
  // Server-side guard: renders the 403 page for roles without `read`.
  const session = await pagePermission("departments", "read");

  const params = toUrlSearchParams(await searchParams);
  const query = parseListQuery(params);
  // Reads go straight through the service (permission + DTO enforced there).
  const data = await listDepartments(query, actorFrom(session));

  const { role } = session.user;
  const canCreate = can(role, "departments", "create");
  const canUpdate = can(role, "departments", "update");
  const canDelete = can(role, "departments", "delete");
  const q = query.q ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Departments"
        description="Organizational units with employee counts."
        actions={<NewDepartmentButton canCreate={canCreate} />}
      />

      <SearchForm
        action="/departments"
        value={q}
        placeholder="Search by name or description…"
        label="Search departments"
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Employees</TableHead>
                <TableHead>Last updated</TableHead>
                {canUpdate || canDelete ? (
                  <TableHead className="text-right">Actions</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={canUpdate || canDelete ? 5 : 4}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {q
                      ? `No departments match “${q}”.`
                      : "No departments yet."}
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((department) => (
                  <TableRow key={department.id}>
                    <TableCell className="font-medium">{department.name}</TableCell>
                    <TableCell className="max-w-xs whitespace-normal text-muted-foreground">
                      {department.description || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {department.employeeCount}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {department.updatedAt.slice(0, 10)}
                    </TableCell>
                    {canUpdate || canDelete ? (
                      <TableCell>
                        <DepartmentRowActions
                          department={department}
                          canUpdate={canUpdate}
                          canDelete={canDelete}
                        />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PaginationNav
        basePath="/departments"
        params={params}
        page={data.page}
        pages={data.pages}
        total={data.total}
        itemLabel="department"
      />
    </div>
  );
}
