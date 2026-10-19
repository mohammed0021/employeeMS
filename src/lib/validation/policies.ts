import { z } from "zod";

/** Upload pipeline states a document can be in (mirrors Prisma `PolicyDocStatus`). */
export const POLICY_STATUSES = ["PROCESSING", "READY", "FAILED"] as const;

/**
 * MIME types the upload endpoint accepts. The allow-list lives here (not as a
 * blocklist) because uploaded bytes are later handed to third-party parsers
 * (pdf-parse, mammoth): anything not on this list never reaches them, which
 * keeps the extraction surface to formats we deliberately support.
 */
export const POLICY_ALLOWED_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type PolicyMimeType = (typeof POLICY_ALLOWED_MIME_TYPES)[number];

/**
 * 5 MB cap. Enforced against the byte length we actually received, not the
 * client-declared `File.size` alone — extraction and chunking run in-request,
 * so an unbounded upload is a memory-exhaustion vector.
 */
export const POLICY_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** List query: free-text search + status/department filters + pagination. */
export const policyListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  limit: z.coerce.number().int().min(1).max(100).catch(20),
  q: z.string().trim().max(100).optional(),
  status: z.enum(POLICY_STATUSES).optional(),
  departmentId: z.string().cuid().optional(),
});

export type PolicyListQuery = z.infer<typeof policyListQuerySchema>;

/**
 * Multipart upload fields other than the file itself. Title stays optional —
 * the service falls back to the file name — but when present it is trimmed and
 * bounded so a crafted title cannot bloat list UIs or audit rows.
 */
export const uploadPolicyFieldsSchema = z.object({
  title: z
    .string()
    .trim()
    .max(200, "Title must be 200 characters or fewer.")
    .optional(),
  departmentId: z.string().cuid().optional(),
});

export type UploadPolicyFields = z.infer<typeof uploadPolicyFieldsSchema>;
