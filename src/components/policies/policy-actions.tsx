"use client";

/**
 * Policy mutation UI: multipart upload and delete.
 *
 * Reads stay server-rendered (the page calls the service directly); only
 * mutations cross the network, then `router.refresh()` re-runs the server
 * render. Permission flags are computed server-side via `can()` and passed
 * down — UX gating only; the API re-checks `policies/create` and
 * `policies/delete` on every request.
 *
 * The upload is deliberately FormData (multipart), never JSON: the route
 * reads `request.formData()` and caps the BYTES it received at 5MB against a
 * MIME allow-list before any parser sees them.
 */
import * as React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PolicyDto, PolicySummaryDto } from "@/lib/services/policies";

type ApiErrorBody = { code?: string; message?: string };

export type DepartmentOption = { id: string; name: string };

/** A <SelectItem> needs a real value — "" would render as "unset". */
const NO_DEPARTMENT = "none";

/** Mirrors uploadPolicyFieldsSchema: title/departmentId are both optional. */
const uploadSchema = z.object({
  title: z.string().trim().max(200, "Title must be 200 characters or fewer."),
  departmentId: z.string(),
});

type UploadValues = z.infer<typeof uploadSchema>;

function uploadDefaults(): UploadValues {
  return { title: "", departmentId: NO_DEPARTMENT };
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </div>
  );
}

/** POST /api/policies — extraction and chunking run inside this request. */
function UploadPolicyDialog({
  departments,
  trigger,
}: {
  departments: DepartmentOption[];
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  // Remounts the native file input on every open — its value cannot be set
  // from state, so a fresh element is the only way to guarantee it starts empty.
  const [formKey, setFormKey] = useState(0);

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UploadValues>({
    resolver: zodResolver(uploadSchema),
    defaultValues: uploadDefaults(),
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // Re-seed on every open so a cancelled upload can't leak stale values.
      reset(uploadDefaults());
      setServerError(null);
      setFile(null);
      setFormKey((key) => key + 1);
    }
  }

  async function onSubmit(values: UploadValues) {
    if (!file) {
      setServerError("Choose a file to upload (.txt, .md, .pdf or .docx, up to 5MB).");
      return;
    }
    setServerError(null);

    const form = new FormData();
    form.append("file", file);
    if (values.title) form.append("title", values.title);
    if (values.departmentId !== NO_DEPARTMENT) {
      form.append("departmentId", values.departmentId);
    }

    try {
      // FormData → the browser sets the multipart boundary itself; adding a
      // JSON content-type here would make the route fail to read the body.
      const response = await fetch("/api/policies", { method: "POST", body: form });

      if (!response.ok) {
        // 409 = already uploaded, 400 = type/size — both carry honest text.
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setServerError(data?.message ?? "Unable to upload the policy.");
        return;
      }

      const dto = (await response.json()) as PolicyDto;

      setOpen(false);
      reset(uploadDefaults());
      setFile(null);

      if (dto.status === "READY") {
        toast.success(`Policy indexed (${dto.chunkCount} chunks)`);
      } else if (dto.status === "FAILED") {
        // 201 but extraction failed: the row exists, nothing is retrievable.
        toast.error(dto.errorMessage ?? "Text extraction failed for this file.");
      } else {
        toast.success("Policy uploaded.");
      }
      router.refresh();
    } catch {
      setServerError("Network error. Please try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button />}>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload policy</DialogTitle>
          <DialogDescription>
            Text is extracted, chunked and indexed for retrieval. Duplicate files are
            rejected.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field label="File" hint=".txt, .md, .pdf or .docx — 5MB max.">
            <Input
              id="policy-file"
              key={formKey}
              type="file"
              accept=".txt,.md,.pdf,.docx"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Field>

          <Field
            label="Title"
            hint="Optional — the file name is used when left blank."
            error={errors.title?.message}
          >
            <Input
              id="policy-title"
              placeholder="Remote work policy"
              {...register("title")}
            />
          </Field>

          <Controller
            control={control}
            name="departmentId"
            render={({ field }) => (
              <Field
                label="Department"
                hint="Optional — leave unset for company-wide policies."
              >
                <Select
                  value={field.value}
                  onValueChange={(value) => field.onChange(value ?? NO_DEPARTMENT)}
                >
                  <SelectTrigger id="policy-department" className="w-full">
                    <SelectValue placeholder="Company-wide" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_DEPARTMENT}>Company-wide</SelectItem>
                    {departments.map((department) => (
                      <SelectItem key={department.id} value={department.id}>
                        {department.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />

          {serverError ? <FormError message={serverError} /> : null}

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Uploading &amp; indexing…
                </>
              ) : (
                "Upload policy"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Header action: create (ADMIN/HR — flag computed server-side). */
export function NewPolicyButton({
  canCreate,
  departments,
}: {
  canCreate: boolean;
  departments: DepartmentOption[];
}) {
  if (!canCreate) return null;
  return (
    <UploadPolicyDialog
      departments={departments}
      trigger={
        <>
          <Plus className="size-4" aria-hidden />
          Upload policy
        </>
      }
    />
  );
}

/** Per-row delete (cascade removes the chunks). */
export function PolicyRowActions({
  policy,
  canDelete,
}: {
  policy: PolicySummaryDto;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!canDelete) return null;

  const indexing = policy.status === "PROCESSING";

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/policies/${policy.id}`, { method: "DELETE" });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setDeleteError(data?.message ?? "Unable to delete this policy.");
        return;
      }

      setConfirmOpen(false);
      toast.success(`“${policy.title}” deleted.`);
      router.refresh();
    } catch {
      setDeleteError("Network error. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        disabled={indexing}
        title={indexing ? "Wait for indexing to finish" : undefined}
        onClick={() => {
          setDeleteError(null);
          setConfirmOpen(true);
        }}
      >
        <Trash2 className="size-4" aria-hidden />
        <span className="sr-only">Delete {policy.title}</span>
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>“{policy.title}”?</DialogTitle>
            <DialogDescription>
              This permanently removes the document and every chunk indexed from it — it
              stops being retrievable by the chatbot immediately.
            </DialogDescription>
          </DialogHeader>

          {deleteError ? <FormError message={deleteError} /> : null}

          <DialogFooter showCloseButton>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Deleting…
                </>
              ) : (
                "Delete policy"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
