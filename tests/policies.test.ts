/**
 * Policy documents: upload → chunking → retrieval (RAG) → delete, plus the
 * dedupe / MIME allow-list / RBAC guards. The retrieval assertion is the
 * OR-lexemes full-text query against a doc created in THIS run — the query is
 * a natural question that never appears verbatim in the document.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { deletePolicy, uploadPolicy, type UploadPolicyInput } from "@/lib/services/policies";
import { retrieveContext } from "@/lib/ai/rag";
import {
  actorFor,
  expectAppError,
  makeUser,
  registerCleanup,
  runCleanups,
  uniqueId,
  type UserFixture,
} from "./helpers";

let admin!: UserFixture;
let employeeUser!: UserFixture;

beforeAll(async () => {
  admin = await makeUser({ role: "ADMIN" });
  employeeUser = await makeUser({ role: "EMPLOYEE" });
});

afterAll(async () => {
  await runCleanups();
});

/** Fresh bytes every run — `PolicyDocument.contentHash` is unique globally. */
function policyBytes(): { uid: string; bytes: Buffer; text: string } {
  const uid = uniqueId("pol");
  const text = [
    `# Leave Policy (${uid})`,
    "",
    "Employees are entitled to twenty days of annual leave per calendar year, in addition to public holidays.",
    "",
    "## Booking annual leave",
    "",
    "Requests must be submitted through the HR portal at least two weeks in advance.",
    "Unused days may be carried over into the next year, up to a maximum of five days.",
    "",
    "## Sick leave",
    "",
    "Sick leave is documented separately and never reduces the annual leave entitlement.",
    "",
    `Document reference: ${uid}.`,
  ].join("\n");
  return { uid, bytes: Buffer.from(text, "utf8"), text };
}

function uploadInput(bytes: Buffer, overrides: Partial<UploadPolicyInput> = {}): UploadPolicyInput {
  return {
    bytes,
    fileName: "leave-policy.md",
    mimeType: "text/markdown",
    ...overrides,
  };
}

/** Register the document + its chunks for this file's cleanup pass. */
function trackDocument(documentId: string): void {
  registerCleanup(async () => {
    await prisma.policyChunk.deleteMany({ where: { documentId } });
    await prisma.policyDocument.deleteMany({ where: { id: documentId } });
  });
}

describe("uploadPolicy", () => {
  it("ingests markdown into a READY document with retrievable chunks", async () => {
    const { bytes } = policyBytes();
    const dto = await uploadPolicy(uploadInput(bytes, { title: "Leave Policy" }), actorFor(admin));

    trackDocument(dto.id);
    expect(dto.status).toBe("READY");
    expect(dto.chunkCount).toBeGreaterThan(0);
    expect(dto.mimeType).toBe("text/markdown");
    expect(dto.sizeBytes).toBe(bytes.length);
    // The full body never leaves the service (DTO has no extractedText).
    expect(Object.keys(dto)).not.toContain("extractedText");

    const chunks = await prisma.policyChunk.findMany({ where: { documentId: dto.id } });
    expect(chunks).toHaveLength(dto.chunkCount);
    expect(chunks[0].content).toContain("twenty days of annual leave");
    expect(chunks[0].documentId).toBe(dto.id);
    expect(chunks[0].chunkIndex).toBe(0);
  });

  it("rejects the same bytes a second time with 409 CONFLICT", async () => {
    const { bytes } = policyBytes();
    const first = await uploadPolicy(uploadInput(bytes), actorFor(admin));
    trackDocument(first.id);

    const error = await expectAppError(
      uploadPolicy(uploadInput(bytes, { title: "Different title" }), actorFor(admin)),
      409,
      "CONFLICT",
    );
    expect(error.message).toMatch(/already uploaded/i);
  });

  it("rejects a MIME type outside the allow-list with 400 before parsing", async () => {
    await expectAppError(
      uploadPolicy(
        uploadInput(Buffer.from("MZ binary-ish payload"), { mimeType: "application/msword" }),
        actorFor(admin),
      ),
      400,
      "VALIDATION_ERROR",
    );
  });

  it("rejects an empty file with 400", async () => {
    await expectAppError(
      uploadPolicy(uploadInput(Buffer.alloc(0)), actorFor(admin)),
      400,
      "VALIDATION_ERROR",
    );
  });

  it("denies EMPLOYEE uploads with 403 (policies/EMPLOYEE is null in the matrix)", async () => {
    await expectAppError(
      uploadPolicy(uploadInput(policyBytes().bytes), actorFor(employeeUser)),
      403,
      "FORBIDDEN",
    );
  });
});

describe("retrieveContext (RAG over this run's document)", () => {
  it("answers a natural question whose exact phrase is NOT in the document", async () => {
    const { bytes, uid } = policyBytes();
    const dto = await uploadPolicy(uploadInput(bytes, { title: `Leave ${uid}` }), actorFor(admin));
    trackDocument(dto.id);

    const question = "how much annual leave do I get";
    const stored = await prisma.policyDocument.findUnique({ where: { id: dto.id } });
    expect(stored?.extractedText).not.toContain(question); // no verbatim match

    const hits = await retrieveContext(question);
    const hit = hits.find((chunk) => chunk.documentId === dto.id);
    expect(hit, "the leave policy chunk must be retrievable for that question").toBeTruthy();
    expect(hit?.documentTitle).toBe(`Leave ${uid}`);
    expect(hit?.content).toContain("annual leave");
    expect(hit?.score).toBeGreaterThan(0);
  });

  it("returns nothing for a degenerate query without touching the corpus", async () => {
    await expect(retrieveContext(" ")).resolves.toEqual([]);
  });
});

describe("deletePolicy", () => {
  it("removes the document and its chunks (count 0 afterwards)", async () => {
    const { bytes } = policyBytes();
    const dto = await uploadPolicy(uploadInput(bytes), actorFor(admin));
    trackDocument(dto.id);
    expect(
      await prisma.policyChunk.count({ where: { documentId: dto.id } }),
    ).toBeGreaterThan(0);

    await deletePolicy(dto.id, actorFor(admin));

    expect(await prisma.policyChunk.count({ where: { documentId: dto.id } })).toBe(0);
    expect(await prisma.policyDocument.findUnique({ where: { id: dto.id } })).toBeNull();
    await expectAppError(deletePolicy(dto.id, actorFor(admin)), 404, "NOT_FOUND");
  });

  it("denies EMPLOYEE deletes with 403", async () => {
    const { bytes } = policyBytes();
    const dto = await uploadPolicy(uploadInput(bytes), actorFor(admin));
    trackDocument(dto.id);
    await expectAppError(deletePolicy(dto.id, actorFor(employeeUser)), 403, "FORBIDDEN");
  });
});
