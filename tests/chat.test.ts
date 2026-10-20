/**
 * Chat service with AI_MOCK=1: both turns persisted, the mock stub label, the
 * auto-title, strict per-user ownership (403s), and RAG sources carried on the
 * assistant reply once a policy has been indexed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createConversation,
  getConversation,
  listConversations,
  sendChatMessage,
} from "@/lib/services/chat";
import { uploadPolicy } from "@/lib/services/policies";
import {
  actorFor,
  expectAppError,
  makeUser,
  registerCleanup,
  runCleanups,
  scopeActorFor,
  uniqueId,
  type UserFixture,
} from "./helpers";

let alice!: UserFixture;
let bob!: UserFixture;
let admin!: UserFixture;

beforeAll(async () => {
  admin = await makeUser({ role: "ADMIN" });
  alice = await makeUser({ role: "EMPLOYEE" });
  bob = await makeUser({ role: "EMPLOYEE" });
});

afterAll(async () => {
  await runCleanups();
});

function trackDocument(documentId: string): void {
  registerCleanup(async () => {
    await prisma.policyChunk.deleteMany({ where: { documentId } });
    await prisma.policyDocument.deleteMany({ where: { id: documentId } });
  });
}

describe("conversation + message flow (AI_MOCK=1)", () => {
  it("persists both turns, labels the model 'mock', and titles from the first message", async () => {
    const conversation = await createConversation(scopeActorFor(alice));
    expect(conversation.title).toBe("New conversation");

    // Gibberish on purpose: retrieval must find nothing, so `sources` stays null.
    const question = `What is the zqxvik ${uniqueId("q")} policy?`;
    const reply = await sendChatMessage(conversation.id, question, scopeActorFor(alice));

    // Assistant turn.
    expect(reply.role).toBe("ASSISTANT");
    expect(reply.model).toBe("mock"); // the stub labels itself
    expect(reply.content).toContain("MOCK MODE");
    expect(reply.sources).toBeNull(); // no indexed chunk → NULL, never []

    // Transcript: the USER turn was written before the model call.
    const loaded = await getConversation(conversation.id, scopeActorFor(alice));
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[0].role).toBe("USER");
    expect(loaded.messages[0].content).toBe(question);
    expect(loaded.messages[1].role).toBe("ASSISTANT");
    expect(loaded.messages[1].model).toBe("mock");

    // Title auto-set from the first 60 chars of the user message.
    expect(loaded.title).toBe(question.slice(0, 60));

    // The usage log recorded the call as provider "mock" (metadata only).
    const usage = await prisma.aiUsageLog.findFirst({
      where: { actorId: alice.id, purpose: "CHATBOT", provider: "mock", model: "mock" },
    });
    expect(usage).not.toBeNull();
    expect(usage?.status).toBe("OK");
  });

  it("keeps a conversation private: another user gets 403 on read AND write", async () => {
    const mine = await createConversation(scopeActorFor(alice), "Private plans");
    await sendChatMessage(mine.id, "Just a note to myself.", scopeActorFor(alice));

    // Ownership is checked BEFORE existence — the id leaks nothing either way.
    await expectAppError(getConversation(mine.id, scopeActorFor(bob)), 403, "FORBIDDEN");
    await expectAppError(
      sendChatMessage(mine.id, "let me in", scopeActorFor(bob)),
      403,
      "FORBIDDEN",
    );
    await expectAppError(getConversation(mine.id, scopeActorFor(admin)), 403, "FORBIDDEN");

    // No stray turn from the intruder landed in the transcript.
    const loaded = await getConversation(mine.id, scopeActorFor(alice));
    expect(loaded.messages.every((m) => m.content !== "let me in")).toBe(true);

    // ...while Bob keeps his own conversations working.
    const bobs = await createConversation(scopeActorFor(bob));
    const reply = await sendChatMessage(bobs.id, "Hello?", scopeActorFor(bob));
    expect(reply.model).toBe("mock");
  });

  it("lists only the caller's own conversations", async () => {
    const page = await listConversations({ page: 1, limit: 50 }, scopeActorFor(alice));
    const bobs = await listConversations({ page: 1, limit: 50 }, scopeActorFor(bob));
    expect(page.total).toBeGreaterThan(0);
    expect(bobs.total).toBeGreaterThan(0);
    const aliceIds = new Set(page.items.map((c) => c.id));
    expect(bobs.items.some((c) => aliceIds.has(c.id))).toBe(false);
  });
});

describe("RAG sources on the reply", () => {
  it("attaches documentId/documentTitle once a matching policy is indexed", async () => {
    const uid = uniqueId("chatpol");
    const text = [
      `# Travel and Leave (${uid})`,
      "",
      "Employees receive twenty days of annual leave each calendar year, plus public holidays.",
      "Carry-over is capped at five days and expires at the end of March.",
      "",
      `Reference ${uid}.`,
    ].join("\n");
    const uploaded = await uploadPolicy(
      {
        bytes: Buffer.from(text, "utf8"),
        fileName: `${uid}.md`,
        mimeType: "text/markdown",
        title: `Travel and Leave ${uid}`,
      },
      actorFor(admin),
    );
    trackDocument(uploaded.id);
    expect(uploaded.status).toBe("READY");

    const conversation = await createConversation(scopeActorFor(alice));
    const reply = await sendChatMessage(
      conversation.id,
      "how much annual leave do employees get?",
      scopeActorFor(alice),
    );

    expect(reply.sources, "a matching chunk must be cited").not.toBeNull();
    const citations = reply.sources!;
    expect(citations.length).toBeGreaterThan(0);
    const citation = citations.find((s) => s.documentId === uploaded.id);
    expect(citation, "our uploaded policy must be among the sources").toBeTruthy();
    expect(citation?.documentTitle).toBe(`Travel and Leave ${uid}`);
    expect(citation?.chunkId).toBeTruthy();

    // The sources JSON survived the round-trip through the database.
    const stored = await prisma.chatMessage.findUnique({
      where: { id: reply.id },
      select: { sources: true, model: true },
    });
    const raw = stored?.sources as Array<Record<string, unknown>> | null;
    expect(Array.isArray(raw)).toBe(true);
    expect(raw?.some((s) => s.documentId === uploaded.id)).toBe(true);
    expect(raw?.[0]).toHaveProperty("documentTitle");
    expect(stored?.model).toBe("mock");
  });
});
