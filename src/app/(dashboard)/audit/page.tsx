import { Metadata } from "next";
import { ModuleShell, PageHeader } from "@/components/layout/page-header";
import { pagePermission } from "@/lib/auth/page-guards";

export const metadata: Metadata = { title: "Audit logs" };

export default async function AuditPage() {
  await pagePermission("audit", "read");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit logs"
        description="Append-only record of significant system actions. Read-only by design."
      />
      <ModuleShell
        phase="Phase 2 (Foundation)"
        scope="Filterable, paginated timeline (actor, action, entity, outcome). No edit or delete route/UI will ever exist."
      />
    </div>
  );
}
