"use client";

/**
 * Chat thread UI: conversation sidebar, message bubbles with citations, and
 * the composer.
 *
 * Reads are server-rendered (the page loads the conversation list and the
 * open thread through the service); this component only owns the live turn:
 * POSTs to /api/chat/conversations/:id/messages and appends what comes back.
 *
 * HONESTY RULES baked in here:
 *  - The user bubble is appended BEFORE the request so the thread never looks
 *    empty during latency; the assistant bubble is only ever the real 201 body.
 *  - A failed turn (429 quota, 503 AI unavailable, validation, network) shows
 *    the API's own message as an in-thread notice — no fake assistant reply.
 *    429/503 happen AFTER the user row was persisted, so that bubble stays;
 *    other failures roll the optimistic bubble back so the thread never
 *    claims something the server did not store.
 *  - `model === "mock"` renders a MOCK badge: a stub is never passed off as a
 *    model answer.
 */
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, SendHorizonal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { ConversationDto, MessageDto } from "@/lib/services/chat";

type ApiErrorBody = { code?: string; message?: string };

/** What pageService(() => getConversation(...)) hands us for `?c=`. */
type ActiveConversation = { id: string; title: string; messages: MessageDto[] };

type Props = {
  conversations: ConversationDto[];
  active: ActiveConversation | null;
};

/** Mirrors sendMessageSchema so a too-long turn is caught before the round trip. */
const MAX_MESSAGE_CHARS = 2000;

export function ChatUi({ conversations, active }: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<MessageDto[]>(active?.messages ?? []);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sidebarError, setSidebarError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest turn in view without hijacking the user's scrollback.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, notice]);

  async function startNewChat() {
    if (creating) return;
    setCreating(true);
    setSidebarError(null);
    try {
      const response = await fetch("/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setSidebarError(data?.message ?? "Unable to start a chat.");
        return;
      }

      const conversation = (await response.json()) as ConversationDto;
      router.push(`/chat?c=${conversation.id}`);
    } catch {
      setSidebarError("Network error. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleSend() {
    const content = draft.trim();
    if (!active || sending || !content) return;

    setDraft("");
    setNotice(null);

    const optimistic: MessageDto = {
      id: `pending-${Date.now()}`,
      role: "USER",
      content,
      sources: null,
      model: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((previous) => [...previous, optimistic]);
    setSending(true);

    try {
      const response = await fetch(`/api/chat/conversations/${active.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        // 429 (daily quota) and 503 (AI unavailable) are thrown AFTER the user
        // row is stored, so the question really is in the transcript. Anything
        // else (validation, ownership, network) never reached the server.
        const persisted = response.status === 429 || response.status === 503;
        if (!persisted) {
          setMessages((previous) =>
            previous.filter((message) => message.id !== optimistic.id),
          );
          setDraft(content); // give the text back — nothing was lost
        }
        setNotice(
          data?.message ??
            (response.status === 429
              ? "Rate limit reached. Try again later."
              : response.status === 503
                ? "The AI provider is unavailable."
                : "Unable to send the message."),
        );
        return;
      }

      const assistant = (await response.json()) as MessageDto;
      setMessages((previous) => [...previous, assistant]);
      // The conversation list is ordered by activity and auto-titled server-side.
      router.refresh();
    } catch {
      setMessages((previous) =>
        previous.filter((message) => message.id !== optimistic.id),
      );
      setDraft(content);
      setNotice("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <Card className="h-fit">
        <CardContent className="space-y-3 p-3">
          <Button className="w-full" onClick={() => void startNewChat()} disabled={creating}>
            {creating ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Plus className="size-4" aria-hidden />
            )}
            New chat
          </Button>

          {sidebarError ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {sidebarError}
            </div>
          ) : null}

          {conversations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No conversations yet.</p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((conversation) => {
                const isActive = conversation.id === active?.id;
                return (
                  <li key={conversation.id}>
                    <Link
                      href={`/chat?c=${conversation.id}`}
                      aria-current={isActive ? "page" : undefined}
                      className={[
                        "flex flex-col gap-0.5 rounded-md px-2 py-1.5 transition-colors",
                        isActive
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent",
                      ].join(" ")}
                    >
                      <span className="truncate text-sm">{conversation.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {relativeTime(conversation.updatedAt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="min-h-[60vh]">
        <CardContent className="flex flex-1 flex-col gap-4 p-4">
          {active ? (
            <>
              <div ref={scrollRef} className="max-h-[60vh] flex-1 space-y-3 overflow-y-auto pr-1">
                <p className="text-center text-xs text-muted-foreground">{active.title}</p>
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
                {notice ? <NoticeRow message={notice} /> : null}
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSend();
                }}
                className="space-y-2"
              >
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask what the policies say… (Enter to send, Shift+Enter for a new line)"
                  maxLength={MAX_MESSAGE_CHARS}
                  rows={3}
                  className="resize-none"
                  disabled={sending}
                />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Every answer cites the policy documents it came from.
                  </p>
                  <Button
                    type="submit"
                    disabled={sending || draft.trim().length === 0}
                  >
                    {sending ? (
                      <>
                        <Loader2 className="animate-spin" aria-hidden />
                        Sending…
                      </>
                    ) : (
                      <>
                        <SendHorizonal className="size-4" aria-hidden />
                        Send
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
              <p className="font-medium">No chat open</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Ask what the company policies say. Answers only come from indexed
                policy documents, and each one lists its sources.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void startNewChat()}
                disabled={creating}
              >
                <Plus className="size-4" aria-hidden />
                New chat
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Models answer in Markdown, but the thread renders plain text — so the
 * `**bold**` markers would show as literal asterisks. Render exactly that
 * one construct (no general Markdown parser: an untrusted full parser is
 * more risk than this UI needs) and leave every other character as typed.
 */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function MessageBubble({ message }: { message: MessageDto }) {
  const isUser = message.role === "USER";

  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={[
          "max-w-[85%] space-y-2 rounded-2xl px-4 py-2.5",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        ].join(" ")}
      >
        <p className="whitespace-pre-wrap text-sm">
          {isUser ? message.content : <RichText text={message.content} />}
        </p>

        {!isUser && message.sources && message.sources.length > 0 ? (
          <div className="flex flex-wrap gap-1 border-t border-foreground/10 pt-2">
            {message.sources.map((source) => (
              <Badge
                key={source.chunkId}
                variant="outline"
                className="max-w-60 font-normal text-muted-foreground"
              >
                <span className="truncate">
                  {source.documentTitle}
                  {source.section ? ` · ${source.section}` : ""}
                </span>
              </Badge>
            ))}
          </div>
        ) : null}

        {!isUser && message.model === "mock" ? (
          <Badge
            variant="secondary"
            title="Answer produced by the local mock stub — not a model response."
          >
            MOCK
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

/** Quota / AI-unavailable / validation failures belong in the thread, not a toast. */
function NoticeRow({ message }: { message: string }) {
  return (
    <div className="flex justify-center">
      <p
        role="alert"
        className="max-w-[85%] rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-center text-sm text-amber-700 dark:text-amber-400"
      >
        {message}
      </p>
    </div>
  );
}

/** Sidebar timestamps: relative while recent, absolute once they age out. */
function relativeTime(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(elapsed)) return iso.slice(0, 10);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return iso.slice(0, 10);
}
