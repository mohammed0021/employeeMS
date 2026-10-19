import { Metadata } from "next";
import { ModuleShell, PageHeader } from "@/components/layout/page-header";
import { pagePermission } from "@/lib/auth/page-guards";

export const metadata: Metadata = { title: "Leave requests" };

export default async function LeavePage() {
  await pagePermission("leave", "readOwn");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave requests"
        description="Submit and track leave. Employees see and cancel their own requests."
      />
      <ModuleShell
        phase="Phase 3 (Core HR)"
        scope="Submission with date-range + overlap validation, status timeline, cancel-own-PENDING, and leave summaries."
      />
    </div>
  );
}
