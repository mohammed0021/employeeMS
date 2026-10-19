/**
 * Policy document service — RBAC + dedupe + extraction/chunking + audit live
 * here, not in the route handler. PERMISSIONS.md: enforcement happens "in
 * services, not just this matrix", so every entry point (API, seed, future
 * server action) is covered even if a caller forgets its `requirePermission()`
 * check.
 *
 * Policies are the RAG source for the chatbot: uploads are parsed into
 * `PolicyChunk` rows that retrieval queries read. Uploads are ADMIN/HR only —
 * employees never see this module (matrix: policies/EMPLOYEE is null).
 */
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type { PolicyDocStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { errors } from "@/lib/errors";
import { can } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit/audit";
import { paginated, type ListQuery } from "@/lib/pagination";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import {
  POLICY_ALLOWED_MIME_TYPES,
  POLICY_MAX_UPLOAD_BYTES,
  type PolicyListQuery,
} from "@/lib/validation/policies";
import type { Actor } from "@/lib/services/actor";

function assert(actor: Actor, action: "create" | "read" | "update" | "delete") {
  if (!can(actor.role, "policies", action)) throw errors.forbidden();
}

/** Map Prisma's unique-constraint error to a clean 409 (never leak SQL). */
function rethrowAsConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw errors.conflict("This file is already uploaded.");
  }
  throw error;
}

// ─── DTOs ───────────────────────────────────────────────────────────────────

/**
 * Wire shape for a policy document. `extractedText` is deliberately NOT part
 * of any DTO: it is the full document body (up to 5MB of text), it is the
 * retrieval corpus — clients get metadata only, and fetch chunks through the
 * retrieval layer under the same `policies/read` permission.
 */
export type PolicyDto = {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: PolicyDocStatus;
  chunkCount: number;
  errorMessage: string | null;
  department: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

/** List variant: lighter rows (no per-row failure detail) for table views. */
export type PolicySummaryDto = Omit<PolicyDto, "errorMessage">;

/**
 * Row shape every mapper accepts. Structural (not `Prisma.*GetPayload`) so it
 * matches both `include`-based single fetches and lean `select`-based lists.
 * `extractedText`/`contentHash` are intentionally absent — the wire shape is
 * defined by what the DTO returns, not by whatever the query happens to fetch.
 */
type PolicyRow = {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: PolicyDocStatus;
  chunkCount: number;
  errorMessage: string | null;
  department: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
};

/** List rows skip `errorMessage` (leaner select; summaries never show it). */
type PolicySummaryRow = Omit<PolicyRow, "errorMessage">;

export function toPolicySummaryDto(row: PolicySummaryRow): PolicySummaryDto {
  return {
    id: row.id,
    title: row.title,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    chunkCount: row.chunkCount,
    department: row.department,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPolicyDto(row: PolicyRow): PolicyDto {
  return { ...toPolicySummaryDto(row), errorMessage: row.errorMessage };
}

/** Department relation projection shared by every query (no over-fetch). */
const departmentSelect = { department: { select: { id: true, name: true } } } as const;

// ─── Queries ────────────────────────────────────────────────────────────────

export type PolicyListFilters = Pick<PolicyListQuery, "status" | "departmentId">;

/**
 * Paginated policy list.
 *
 * Requires `policies/read` (ADMIN/HR only — employees have no access at all,
 * so there is no `readOwn` scoping here). Returns the summary variant: no
 * `extractedText`, no `errorMessage`, so a list call can never leak document
 * bodies or internal parser failures to a screen that doesn't render them.
 */
export async function listPolicies(
  query: ListQuery,
  filters: PolicyListFilters,
  actor: Actor,
): Promise<{
  items: PolicySummaryDto[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}> {
  assert(actor, "read");

  const search = query.q;
  const where: Prisma.PolicyDocumentWhereInput = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { fileName: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.policyDocument.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: { id: true, title: true, fileName: true, mimeType: true, sizeBytes: true, status: true, chunkCount: true, createdAt: true, updatedAt: true, ...departmentSelect },
    }),
    prisma.policyDocument.count({ where }),
  ]);

  return paginated(rows.map(toPolicySummaryDto), total, query);
}

/**
 * Single policy document by id (full DTO, including `errorMessage` so the
 * detail view can explain a FAILED row).
 *
 * Requires `policies/read`; 404 on unknown id reveals nothing to callers
 * without the permission, because the assert runs before the lookup.
 */
export async function getPolicy(id: string, actor: Actor): Promise<PolicyDto> {
  assert(actor, "read");
  const row = await prisma.policyDocument.findUnique({
    where: { id },
    include: departmentSelect,
  });
  if (!row) throw errors.notFound("Policy document not found.");
  return toPolicyDto(row);
}

// ─── Text extraction & chunking ─────────────────────────────────────────────

/**
 * Extract plain text per MIME type. Unsupported types are rejected before the
 * bytes reach any parser (the allow-list is the security boundary — these
 * parsers historically have had CVEs, so nothing outside the four formats we
 * test ever gets parsed). Throws; the caller converts extraction failures into
 * a FAILED document row instead of a request error.
 */
async function extractText(bytes: Buffer, mimeType: string): Promise<string> {
  switch (mimeType) {
    case "text/plain":
    case "text/markdown":
      return bytes.toString("utf8");
    case "application/pdf": {
      const parser = new PDFParse({ data: bytes });
      try {
        const result = await parser.getText();
        return result.text;
      } finally {
        await parser.destroy().catch(() => undefined);
      }
    }
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      const result = await mammoth.extractRawText({ buffer: bytes });
      return result.value;
    }
    default:
      throw errors.validation(
        `Unsupported file type "${mimeType}". Allowed: ${POLICY_ALLOWED_MIME_TYPES.join(", ")}.`,
      );
  }
}

/** ~1200 chars per chunk: retrieval wants passages, not paragraphs or pages. */
const CHUNK_TARGET_CHARS = 1200;

/** Short line starting with `#`, or a short ALL-CAPS line (e.g. "BENEFITS"). */
function detectHeading(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return null;
  const markdown = /^#{1,6}\s+(.+)$/.exec(trimmed);
  if (markdown) return markdown[1].trim().slice(0, 80) || null;
  // ALL-CAPS heuristic: has letters, no lowercase, long enough to be a label
  // but not a shouted sentence. Strip a trailing colon ("NOTES:" → "NOTES").
  if (trimmed.length >= 3 && /[A-Z]/.test(trimmed) && !/[a-z]/.test(trimmed)) {
    return trimmed.replace(/:$/, "").slice(0, 80);
  }
  return null;
}

/**
 * Break text that exceeds `max` at sentence boundaries first, then at word
 * boundaries. Never mid-word unless a single token is longer than `max`
 * (no boundary exists — refusing to split would loop forever).
 */
function splitLongParagraph(text: string, max: number): string[] {
  const sentences =
    text.match(/[^.!?…\n]*[.!?…]+[\s"')\]]*|[^.!?…\n]+/g) ?? [text];
  const pieces: string[] = [];
  let buffer = "";
  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    if (buffer.length > 0 && buffer.length + 1 + piece.length > max) {
      pieces.push(buffer);
      buffer = "";
    }
    buffer = buffer.length > 0 ? `${buffer} ${piece}` : piece;
  }
  if (buffer.length > 0) pieces.push(buffer);

  // Sentences longer than max (minified text, data dumps) still need cutting.
  return pieces.flatMap((piece) =>
    piece.length <= max ? [piece] : splitAtWordBoundary(piece, max),
  );
}

function splitAtWordBoundary(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut <= 0) cut = max; // single token > max: no word boundary to use
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) out.push(rest);
  return out;
}

type ChunkDraft = { section: string | null; content: string };

/**
 * Split extracted text into retrieval chunks.
 *
 * Packs whole paragraphs (`\n\n`) up to ~1200 chars — cutting on paragraph
 * boundaries keeps passages coherent, and word-level fallbacks mean no chunk
 * ever ends mid-word. Whitespace-only chunks are dropped. `section` is the
 * nearest preceding heading (markdown `#` or short ALL-CAPS line), which lets
 * answers cite "section: Benefits" without the chunk restating its title.
 */
function chunkText(text: string): ChunkDraft[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const paragraphs = normalized.split(/\n{2,}/);

  const chunks: ChunkDraft[] = [];
  let buffer: string[] = [];
  let bufferLen = 0;
  let runningSection: string | null = null; // last heading seen so far
  let openSection: string | null = null; // section of the chunk being built

  const flush = () => {
    if (buffer.length === 0) return;
    chunks.push({ section: openSection, content: buffer.join("\n\n") });
    buffer = [];
    bufferLen = 0;
  };

  for (const paragraph of paragraphs) {
    for (const line of paragraph.split("\n")) {
      const heading = detectHeading(line);
      if (heading !== null) runningSection = heading;
    }
    const pieces =
      paragraph.length > CHUNK_TARGET_CHARS
        ? splitLongParagraph(paragraph, CHUNK_TARGET_CHARS)
        : [paragraph];
    for (const rawPiece of pieces) {
      const piece = rawPiece.trim();
      if (piece.length === 0) continue; // whitespace-only: nothing to retrieve
      if (buffer.length > 0 && bufferLen + 2 + piece.length > CHUNK_TARGET_CHARS) {
        flush();
      }
      if (buffer.length === 0) openSection = runningSection;
      buffer.push(piece);
      bufferLen += (buffer.length > 1 ? 2 : 0) + piece.length;
    }
  }
  flush();

  return chunks;
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export type UploadPolicyInput = {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
  title?: string;
  departmentId?: string;
};

/**
 * Ingest an uploaded policy document: dedupe by content hash, extract text,
 * chunk it, and store document + chunks atomically.
 *
 * Requires `policies/create` (ADMIN/HR). `uploadedById` is always `actor.id` —
 * the client never supplies it, so an upload cannot be attributed to someone
 * else. The MIME allow-list and size cap are re-checked here even though the
 * route enforces them: the service is the trust boundary, routes may change.
 *
 * Extraction failures do NOT fail the request — they produce a FAILED row (so
 * the user sees *which* file failed and why) plus a FAILURE audit entry.
 * Duplicates (same bytes, regardless of title/department) are a 409 before
 * any parsing work; the unique `contentHash` constraint backs this up against
 * races, and its P2002 is rethrown as the same 409 — never a 500.
 */
export async function uploadPolicy(
  input: UploadPolicyInput,
  actor: Actor,
): Promise<PolicyDto> {
  assert(actor, "create");

  const fileName = input.fileName.trim().slice(0, 255) || "upload";
  const mimeType = input.mimeType.toLowerCase();

  if (!(POLICY_ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw errors.validation(
      `Unsupported file type "${input.mimeType}". Allowed: ${POLICY_ALLOWED_MIME_TYPES.join(", ")}.`,
    );
  }
  if (input.bytes.length === 0) throw errors.validation("Uploaded file is empty.");
  if (input.bytes.length > POLICY_MAX_UPLOAD_BYTES) {
    throw errors.validation("File exceeds the 5MB upload limit.");
  }

  if (input.departmentId) {
    const department = await prisma.department.findUnique({
      where: { id: input.departmentId },
    });
    if (!department) throw errors.notFound("Department not found.");
  }

  const contentHash = createHash("sha256").update(input.bytes).digest("hex");
  const duplicate = await prisma.policyDocument.findUnique({ where: { contentHash } });
  if (duplicate) throw errors.conflict("This file is already uploaded.");

  const title = input.title?.trim() || fileName;
  const common: Pick<
    Prisma.PolicyDocumentUncheckedCreateInput,
    "title" | "fileName" | "mimeType" | "sizeBytes" | "contentHash" | "departmentId" | "uploadedById"
  > = {
    title,
    fileName,
    mimeType,
    sizeBytes: input.bytes.length,
    contentHash,
    departmentId: input.departmentId ?? null,
    // Security: attribution comes from the session actor, never the request.
    uploadedById: actor.id,
  };

  let extractedText: string;
  try {
    extractedText = await extractText(input.bytes, mimeType);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) rethrowAsConflict(error);
    // Parser errors are server-side only; the user gets a safe summary.
    console.error("[policies] text extraction failed:", fileName, error);
    let row;
    try {
      row = await prisma.policyDocument.create({
        data: {
          ...common,
          status: "FAILED",
          chunkCount: 0,
          extractedText: null,
          errorMessage:
            "Could not extract text from this file. It may be corrupted, password-protected, or contain only images.",
        },
        include: departmentSelect,
      });
    } catch (createError) {
      rethrowAsConflict(createError);
    }
    await recordAudit({
      actor,
      action: AUDIT_ACTIONS.POLICY_UPLOADED,
      entityType: "PolicyDocument",
      entityId: row.id,
      outcome: "FAILURE",
      metadata: {
        documentId: row.id,
        chunkCount: 0,
        fileName,
        sizeBytes: input.bytes.length,
        reason: "extraction_failed",
      },
    });
    return toPolicyDto(row);
  }

  const chunks = chunkText(extractedText);

  let row;
  try {
    // Document + chunks commit together: a READY row must never exist without
    // its retrieval units (and vice versa — no half-ingested corpus).
    row = await prisma.$transaction(async (tx) => {
      const doc = await tx.policyDocument.create({
        data: {
          ...common,
          status: "READY",
          chunkCount: chunks.length,
          extractedText,
        },
        include: departmentSelect,
      });
      if (chunks.length > 0) {
        await tx.policyChunk.createMany({
          data: chunks.map((chunk, index) => ({
            documentId: doc.id,
            chunkIndex: index,
            section: chunk.section,
            content: chunk.content,
          })),
        });
      }
      return doc;
    });
  } catch (error) {
    rethrowAsConflict(error);
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.POLICY_UPLOADED,
    entityType: "PolicyDocument",
    entityId: row.id,
    metadata: {
      documentId: row.id,
      chunkCount: chunks.length,
      fileName,
      sizeBytes: input.bytes.length,
    },
  });

  return toPolicyDto(row);
}

/**
 * Delete a policy document and its chunks.
 *
 * Requires `policies/delete` (ADMIN/HR). Chunk cleanup relies on the schema's
 * `onDelete: Cascade` — no manual chunk deletion, so there is no window where
 * orphaned chunks outlive their document. The title is captured *before* the
 * delete for the audit entry (post-delete reads return nothing).
 */
export async function deletePolicy(id: string, actor: Actor): Promise<void> {
  assert(actor, "delete");

  const existing = await prisma.policyDocument.findUnique({ where: { id } });
  if (!existing) throw errors.notFound("Policy document not found.");

  await prisma.policyDocument.delete({ where: { id } });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.POLICY_DELETED,
    entityType: "PolicyDocument",
    entityId: id,
    metadata: { documentId: id, title: existing.title },
  });
}
