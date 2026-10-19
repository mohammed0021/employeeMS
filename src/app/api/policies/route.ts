import { NextRequest } from "next/server";
import { apiHandler, errors } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guards";
import { actorFrom } from "@/lib/services/actor";
import { listPolicies, uploadPolicy } from "@/lib/services/policies";
import {
  POLICY_ALLOWED_MIME_TYPES,
  policyListQuerySchema,
} from "@/lib/validation/policies";

/**
 * GET /api/policies — list (read: ADMIN/HR only).
 *
 * Filters and pagination are parsed through the zod schema so status is
 * restricted to the enum (never interpolated into a query) and page/limit are
 * bounded. `extractedText` never leaves the service layer (see PolicyDto).
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const session = await requirePermission("policies", "read");
  const params = request.nextUrl.searchParams;
  const parsed = policyListQuerySchema.parse({
    page: params.get("page") ?? undefined,
    limit: params.get("limit") ?? undefined,
    q: params.get("q") ?? undefined,
    status: params.get("status") ?? undefined,
    departmentId: params.get("departmentId") ?? undefined,
  });
  const { page, limit, q, status, departmentId } = parsed;
  const result = await listPolicies(
    { page, limit, q },
    { status, departmentId },
    actorFrom(session),
  );
  return Response.json(result);
});

/**
 * POST /api/policies — multipart upload (create: ADMIN/HR only).
 *
 * The file's byte length (not the client-declared metadata) is what we cap at
 * 5MB, and the MIME allow-list is checked before parsing so arbitrary content
 * never reaches pdf-parse/mammoth. Attribution (`uploadedById`) comes from the
 * session actor inside the service, never from the form.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const session = await requirePermission("policies", "create");

  const form = await request.formData();
  const file = form.get("file") as File | null;
  if (!file || typeof file.arrayBuffer !== "function") {
    throw errors.validation("A file is required.");
  }
  if (file.size === 0) {
    throw errors.validation("Uploaded file is empty.");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw errors.validation("File exceeds the 5MB upload limit.");
  }
  if (!(POLICY_ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw errors.validation(
      `Unsupported file type "${file.type || "unknown"}". Allowed: ${POLICY_ALLOWED_MIME_TYPES.join(", ")}.`,
    );
  }

  const departmentId = form.get("departmentId") as string | null;
  const title = form.get("title") as string | null;

  const dto = await uploadPolicy(
    {
      bytes: Buffer.from(await file.arrayBuffer()),
      fileName: file.name || "upload",
      mimeType: file.type,
      title: title ?? undefined,
      departmentId: departmentId ?? undefined,
    },
    actorFrom(session),
  );
  return Response.json(dto, { status: 201 });
});
