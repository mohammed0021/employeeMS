import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth/guards";
import { AppShell } from "@/components/layout/app-shell";

/**
 * Authenticated shell. This is the SECOND enforcement layer:
 *  - proxy.ts already gated cookie presence (coarse, edge)
 *  - here we resolve the real session from the DB (authoritative)
 * Individual pages still call requireRole()/requirePermission() for their
 * own access rules — this layout only guarantees "some signed-in user".
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await currentSession();
  if (!session) redirect("/login");

  const userLabel = session.user.employee
    ? `${session.user.employee.firstName} ${session.user.employee.lastName}`
    : session.user.email;

  return (
    <AppShell role={session.user.role} userLabel={userLabel}>
      {children}
    </AppShell>
  );
}
