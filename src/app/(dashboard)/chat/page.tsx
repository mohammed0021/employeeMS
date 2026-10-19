import { Metadata } from "next";
import { ModuleShell, PageHeader } from "@/components/layout/page-header";
import { pagePermission } from "@/lib/auth/page-guards";

export const metadata: Metadata = { title: "HR policy chatbot" };

export default async function ChatPage() {
  await pagePermission("chat", "read");

  return (
    <div className="space-y-6">
      <PageHeader
        title="HR policy chatbot"
        description="Answers grounded in approved policy documents (RAG) — with sources."
      />
      <ModuleShell
        phase="Phase 4 (AI)"
        scope="Conversation UI, retrieval over Postgres full-text search, source-aware answers, graceful AI failure states, per-user daily quota."
      />
    </div>
  );
}
