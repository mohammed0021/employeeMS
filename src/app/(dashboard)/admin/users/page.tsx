import { Metadata } from "next";
import { ModuleShell, PageHeader } from "@/components/layout/page-header";
import { pagePermission } from "@/lib/auth/page-guards";

export const metadata: Metadata = { title: "Users & roles" };

export default async function AdminUsersPage() {
  await pagePermission("users", "read");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users & roles"
        description="Accounts, role assignment and activation. No self-service role changes."
      />
      <ModuleShell
        phase="Phase 2 (Foundation)"
        scope="Create users (admin only), change roles, activate/deactivate with session revocation, last-admin protection, audited changes."
      />
    </div>
  );
}
