import { Metadata } from "next";
import { ModuleShell, PageHeader } from "@/components/layout/page-header";
import { pagePermission } from "@/lib/auth/page-guards";

export const metadata: Metadata = { title: "Performance feedback" };

export default async function FeedbackPage() {
  await pagePermission("feedback", "readOwn");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Performance feedback"
        description="AI-assisted drafts reviewed and finalized by humans — never automatic decisions."
      />
      <ModuleShell
        phase="Phase 4 (AI)"
        scope="Indicator form, draft generation (verified facts vs. opinions clearly separated), edit, finalize with actor+timestamp. Employees read their own finalized feedback."
      />
    </div>
  );
}
