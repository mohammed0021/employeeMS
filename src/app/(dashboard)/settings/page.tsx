import { Metadata } from "next";
import { ModuleShell, PageHeader } from "@/components/layout/page-header";
import { pagePermission } from "@/lib/auth/page-guards";

export const metadata: Metadata = { title: "Profile & settings" };

export default async function SettingsPage() {
  await pagePermission("dashboard", "read");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile & settings"
        description="Your account, password and session preferences."
      />
      <ModuleShell
        phase="Phase 2 (Foundation)"
        scope="Profile read-only fields, change-password form (revokes all sessions), session info."
      />
    </div>
  );
}
