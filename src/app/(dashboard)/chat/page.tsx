import { Metadata } from "next";
import { AlertTriangle } from "lucide-react";

import { ChatUi } from "@/components/chat/chat-ui";
import { PageHeader } from "@/components/layout/page-header";
import { aiConfigured } from "@/lib/ai/provider";
import { pagePermission, pageService } from "@/lib/auth/page-guards";
import { toUrlSearchParams } from "@/lib/pagination";
import { actorFrom } from "@/lib/services/actor";
import { getConversation, listConversations } from "@/lib/services/chat";

export const metadata: Metadata = { title: "HR policy chatbot" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ChatPage({ searchParams }: PageProps) {
  // Every role holds `create` and `read` on chat; rows are scoped to their
  // owner inside the service, so nobody — ADMIN included — sees another
  // user's conversations.
  const session = await pagePermission("chat", "create");

  const params = toUrlSearchParams(await searchParams);
  const activeId = params.get("c");
  const actor = actorFrom(session);

  const conversations = await listConversations({ page: 1, limit: 50 }, actor);
  // Unknown or foreign id → 403/404 page, never a 500.
  const active = activeId ? await pageService(() => getConversation(activeId, actor)) : null;

  const aiReady = aiConfigured();

  return (
    <div className="space-y-6">
      <PageHeader
        title="HR policy chatbot"
        description="Answers grounded in approved policy documents (RAG) — with sources."
      />

      {aiReady ? null : (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            AI is not configured — messages will return an error until
            OPENROUTER_API_KEY is set or AI_MOCK=1.
          </p>
        </div>
      )}

      {/* Keyed on the thread id: switching conversations remounts the client
          state from fresh server data, while `router.refresh()` after a send
          keeps the messages we already rendered. */}
      <ChatUi key={active?.id ?? "new"} conversations={conversations.items} active={active} />
    </div>
  );
}
