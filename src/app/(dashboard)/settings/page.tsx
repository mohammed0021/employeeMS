import { Metadata } from "next";

import { ChangePasswordForm } from "@/components/settings/change-password";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { pageService, pageUser } from "@/lib/auth/page-guards";
import { employeeScopeFrom } from "@/lib/services/actor";
import { getEmployee } from "@/lib/services/employees";

export const metadata: Metadata = { title: "Profile & settings" };

export default async function SettingsPage() {
  // Any signed-in user — no permission gate beyond being signed in.
  const session = await pageUser();
  const { email, role, employeeId } = session.user;

  // The session's own employee id; the service still does the scoping
  // (readOwn ⇒ only this record) and pageService maps 403/404 to pages.
  const employee = employeeId
    ? await pageService(() => getEmployee(employeeId, employeeScopeFrom(session)))
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile & settings"
        description="Your account, password and session preferences."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              Read-only — held by HR. Contact them to correct anything here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row label="Email" value={email} mono />
            <Row label="Role">
              <Badge variant={role === "ADMIN" ? "default" : role === "HR" ? "secondary" : "outline"}>
                {role}
              </Badge>
            </Row>

            {employee ? (
              <>
                <Row label="Employee code" value={employee.employeeCode} mono />
                <Row label="Full name" value={employee.fullName} />
                <Row label="Position" value={employee.position} />
                <Row label="Department" value={employee.department?.name ?? "—"} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No employee record is linked to your account yet.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>
              You need your current password. The new one must be at least 10 characters
              with a letter and a number.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>
      </div>

      <Card size="sm">
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Changing your password revokes every active session, including this one on
            other devices. You will be asked to sign in again with the new password.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/** Read-only label/value row used by the profile card. */
function Row({
  label,
  value,
  mono,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children ??
        <span className={`truncate text-sm ${mono ? "font-mono" : "font-medium"}`}>
          {value}
        </span>}
    </div>
  );
}
