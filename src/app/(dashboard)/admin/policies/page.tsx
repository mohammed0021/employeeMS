import { Metadata } from "next";
import { ModuleShell, PageHeader } from "@/components/layout/page-header";
import { pagePermission } from "@/lib/auth/page-guards";

export const metadata: Metadata = { title: "Policy documents" };

export default async function AdminPoliciesPage() {
  await pagePermission("policies", "read");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Policy documents"
        description="Approved documents that ground the HR chatbot's answers."
      />
      <ModuleShell
        phase="Phase 4 (AI)"
        scope="Upload (txt/md/pdf/docx ≤5MB, mime + hash dedupe), text extraction, chunking, full-text index status, delete cascades chunks, all audited."
      />
    </div>
  );
}
