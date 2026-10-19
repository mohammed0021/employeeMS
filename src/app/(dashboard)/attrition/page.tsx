import { Metadata } from "next";
import { ModuleShell, PageHeader } from "@/components/layout/page-header";
import { pagePermission } from "@/lib/auth/page-guards";

export const metadata: Metadata = { title: "Attrition analytics" };

export default async function AttritionPage() {
  await pagePermission("attrition", "read");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attrition analytics"
        description="Decision-support risk estimates — uncertain, never grounds for automated employment actions."
      />
      <ModuleShell
        phase="Phase 4 (ML)"
        scope="Risk distribution, department summaries, contributing indicators, model card with measured metrics and dataset limitations, batch prediction runs."
      />
    </div>
  );
}
