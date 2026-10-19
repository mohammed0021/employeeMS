import { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { pagePermission } from "@/lib/auth/page-guards";
import { actorFrom } from "@/lib/services/actor";
import { listDepartments } from "@/lib/services/departments";
import { parseListQuery, toUrlSearchParams } from "@/lib/pagination";
import { can } from "@/lib/auth/permissions";
import {
  DepartmentRowActions,
  NewDepartmentButton,
} from "@/components/departments/department-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

/** Preserve the active search while paging. */
function pageHref(page: number, q: string): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/departments?${qs}` : "/departments";
}

export default async function DepartmentsPage({ searchParams }: PageProps) {
  // Server-side guard: renders the 403 page for roles without `read`.
  const session = await pagePermission("departments", "read");

  const query = parseListQuery(toUrlSearchParams(await searchParams));
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

      <form action="/departments" method="get" className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by name or description…"
          aria-label="Search departments"
          className="h-8 w-full max-w-xs"
        />
        <Button type="submit" variant="outline" size="sm">
          <Search className="size-4" aria-hidden />
          Search
        </Button>
        {q ? (
          // Plain link — a second submit button would still post `q`.
          <Button render={<Link href="/departments" />} variant="ghost" size="sm">
            Clear
          </Button>
        ) : null}
      </form>

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

      {data.pages > 1 ? (
        <nav
          aria-label="Department pages"
          className="flex items-center justify-between text-sm"
        >
          <span className="text-muted-foreground">
            Page {data.page} of {data.pages} · {data.total} department
            {data.total === 1 ? "" : "s"}
          </span>
          <span className="flex gap-2">
            {data.page > 1 ? (
              <Button
                render={<Link href={pageHref(data.page - 1, q)} />}
                variant="outline"
                size="sm"
              >
                Previous
              </Button>
            ) : null}
            {data.page < data.pages ? (
              <Button
                render={<Link href={pageHref(data.page + 1, q)} />}
                variant="outline"
                size="sm"
              >
                Next
              </Button>
            ) : null}
          </span>
        </nav>
      ) : null}
    </div>
  );
}
