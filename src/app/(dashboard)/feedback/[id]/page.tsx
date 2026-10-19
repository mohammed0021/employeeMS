import { Metadata } from "next";
import { ModuleShell, PageHeader } from "@/components/layout/page-header";
import { pagePermission } from "@/lib/auth/page-guards";

export const metadata: Metadata = { title: "Feedback detail" };

type Props = { params: Promise<{ id: string }> };

export default async function FeedbackDetailPage({ params }: Props) {
  const { id } = await params;
  // Role gate: ADMIN/HR read any, EMPLOYEE readOwn — row-level ownership is
  // enforced when loading the record (Phase 4 feedback service).
  await pagePermission("feedback", "readOwn");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Feedback detail"
        description="Draft vs. finalized states with authorship and timestamps."
      />
      <ModuleShell
        phase="Phase 4 (AI)"
        scope={`Record ${id}: AI draft pane, human editor, finalize action, history, and role-scoped read access.`}
      />
    </div>
  );
}
