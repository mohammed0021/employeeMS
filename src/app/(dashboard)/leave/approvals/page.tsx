import { Metadata } from "next";
import { ModuleShell, PageHeader } from "@/components/layout/page-header";
import { pagePermission } from "@/lib/auth/page-guards";

export const metadata: Metadata = { title: "Leave approvals" };

export default async function LeaveApprovalsPage() {
  await pagePermission("leave", "approve");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave approvals"
        description="Review pending requests and record approve/reject decisions."
      />
      <ModuleShell
        phase="Phase 3 (Core HR)"
        scope="Approval queue with employee context, reject-reason modal, state machine (PENDING→APPROVED/REJECTED/CANCELLED), self-approval blocked, decision history."
      />
    </div>
  );
}
