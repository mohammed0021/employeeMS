import { Metadata } from "next";
import Link from "next/link";

import {
  NewUserButton,
  UserRowActions,
  type EmployeeOption,
} from "@/components/admin/user-actions";
import { PageHeader } from "@/components/layout/page-header";
import { PaginationNav, SearchForm } from "@/components/layout/list-controls";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { pageRole } from "@/lib/auth/page-guards";
import { parseListQuery, toUrlSearchParams } from "@/lib/pagination";
import { actorFrom, employeeScopeFrom } from "@/lib/services/actor";
import { listUsers, type UserDto } from "@/lib/services/admin-users";
import { listEmployees } from "@/lib/services/employees";
import { adminUserFilterSchema } from "@/lib/validation/admin";

export const metadata: Metadata = { title: "Users & roles" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Sentinel for "no filter"; real roles/statuses are never "all". */
const ALL = "all";

export default async function AdminUsersPage({ searchParams }: PageProps) {
  // User management is ADMIN-by-role (the permission matrix has no "users"
  // resource to ask about). The service re-asserts the role from the
  // session-derived actor, and every API route re-checks on top of that.
  const session = await pageRole("ADMIN");

  const params = toUrlSearchParams(await searchParams);
  const query = parseListQuery(params);
  const filters = adminUserFilterSchema.parse({
    role: params.get("role") ?? undefined,
    status: params.get("status") ?? undefined,
  });

  const actor = actorFrom(session);
  const [data, employees] = await Promise.all([
    listUsers(query, filters, actor),
    // Picker options for the create dialog — ADMIN holds employees/read.
    listEmployees(
      { page: 1, limit: 100, q: undefined },
      {},
      { field: "lastName", dir: "asc" },
      employeeScopeFrom(session),
    ),
  ]);

  const q = query.q ?? "";
  const activeRole = filters.role ?? "";
  const activeStatus = filters.status ?? "";

  const employeeOptions: EmployeeOption[] = employees.items.map((employee) => ({
    id: employee.id,
    label: `${employee.employeeCode} · ${employee.fullName}`,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users & roles"
        description="Accounts, role assignment and activation. No self-service role changes."
        actions={<NewUserButton employees={employeeOptions} />}
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchForm
          action="/admin/users"
          value={q}
          placeholder="Search email, name or code…"
          label="Search users"
        />
        <FilterRow
          basePath="/admin/users"
          params={params}
          name="role"
          allLabel="All roles"
          options={[
            { value: "ADMIN", label: "ADMIN" },
            { value: "HR", label: "HR" },
            { value: "EMPLOYEE", label: "EMPLOYEE" },
          ]}
        />
        <FilterRow
          basePath="/admin/users"
          params={params}
          name="status"
          allLabel="All statuses"
          options={[
            { value: "ACTIVE", label: "ACTIVE" },
            { value: "DISABLED", label: "DISABLED" },
          ]}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Linked employee</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    {q || activeRole || activeStatus
                      ? "No accounts match the current filters."
                      : "No accounts yet."}
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-mono text-sm">{user.email}</TableCell>
                    <TableCell>
                      <RoleBadge role={user.role} />
                    </TableCell>
                    <TableCell>
                      <UserStatusBadge status={user.status} />
                    </TableCell>
                    <TableCell>
                      {user.employee
                        ? `${user.employee.employeeCode} · ${user.employee.fullName}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleDateString()
                        : "never"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.createdAt.slice(0, 10)}
                    </TableCell>
                    <TableCell>
                      <UserRowActions user={user} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PaginationNav
        basePath="/admin/users"
        params={params}
        page={data.page}
        pages={data.pages}
        total={data.total}
        itemLabel="account"
      />
    </div>
  );
}

function RoleBadge({ role }: { role: UserDto["role"] }) {
  const variant = role === "ADMIN" ? "default" : role === "HR" ? "secondary" : "outline";
  return <Badge variant={variant}>{role}</Badge>;
}

/** ACTIVE reads green, DISABLED reads neutral gray — status is never colour-only. */
function UserStatusBadge({ status }: { status: UserDto["status"] }) {
  if (status === "ACTIVE") {
    return (
      <Badge className="border-transparent bg-emerald-600/15 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
        ACTIVE
      </Badge>
    );
  }
  return <Badge variant="secondary">DISABLED</Badge>;
}

/**
 * A single filter rendered as a row of toggle links (copied from the
 * employees list rather than imported, so no page depends on another page's
 * internals). Links, not a GET form: a submit would drop the other filter and
 * the search term. Clicking the active value clears the filter.
 */
function FilterRow({
  basePath,
  params,
  name,
  options,
  allLabel,
}: {
  basePath: string;
  params: URLSearchParams;
  name: string;
  options: Array<{ value: string; label: string }>;
  allLabel: string;
}) {
  const active = params.get(name) ?? "";

  function hrefFor(next: string): string {
    const clone = new URLSearchParams(params.toString());
    if (!next || next === active) clone.delete(name);
    else clone.set(name, next);
    const qs = clone.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const chips = [{ value: "", label: allLabel }, ...options];

  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={allLabel}>
      {chips.map((chip) => {
        const isActive = chip.value === active;
        return (
          <Link
            key={chip.value || ALL}
            href={hrefFor(chip.value)}
            aria-pressed={isActive}
            className={[
              "inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors",
              isActive
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-transparent text-foreground hover:bg-accent",
            ].join(" ")}
          >
            {chip.label}
          </Link>
        );
      })}
    </div>
  );
}
