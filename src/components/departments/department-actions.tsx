"use client";

/**
 * Department mutation UI: create, edit and delete.
 *
 * Reads stay server-rendered (the page calls the service directly); only
 * mutations cross the network, then `router.refresh()` re-runs the server
 * render. Permission flags are computed server-side via `can()` and passed
 * down — this is UX gating only; the API re-checks every request.
 */
import * as React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import type { DepartmentDto } from "@/lib/dto";

/** Mirrors src/lib/validation/departments.ts for instant field feedback. */
const departmentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters.")
    .max(80, "Name must be 80 characters or fewer."),
  description: z
    .string()
    .trim()
    .max(500, "Description must be 500 characters or fewer."),
});

type DepartmentFormValues = z.infer<typeof departmentSchema>;

type ApiErrorBody = {
  message?: string;
  fields?: Array<{ path: string; message: string }>;
};

function defaultsFor(department?: DepartmentDto): DepartmentFormValues {
  return {
    name: department?.name ?? "",
    description: department?.description ?? "",
  };
}

function DepartmentFormDialog({
  department,
  trigger,
}: {
  department?: DepartmentDto;
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const isEdit = Boolean(department);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DepartmentFormValues>({
    resolver: zodResolver(departmentSchema),
    defaultValues: defaultsFor(department),
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // Re-seed on every open so a cancelled edit can't leak stale values.
      reset(defaultsFor(department));
      setServerError(null);
    }
  }

  async function onSubmit(values: DepartmentFormValues) {
    setServerError(null);

    // On edit an empty description means "clear it" (send null); on create
    // it means "leave it unset" (omit the key) — the two Zod schemas differ.
    const body: Record<string, unknown> = { name: values.name };
    if (isEdit) body.description = values.description === "" ? null : values.description;
    else if (values.description !== "") body.description = values.description;

    try {
      const response = await fetch(
        isEdit ? `/api/departments/${department?.id}` : "/api/departments",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setServerError(
          data?.message ??
            (isEdit ? "Unable to update the department." : "Unable to create the department."),
        );
        return;
      }

      setOpen(false);
      reset(defaultsFor(department));
      toast.success(isEdit ? "Department updated." : "Department created.");
      router.refresh();
    } catch {
      setServerError("Network error. Please try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button />}>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit department" : "New department"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the department's name and description."
              : "Add an organizational unit. You can assign employees to it afterwards."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor={`dept-name-${department?.id ?? "new"}`}>Name</Label>
            <Input
              id={`dept-name-${department?.id ?? "new"}`}
              placeholder="e.g. Engineering"
              aria-invalid={Boolean(errors.name)}
              {...register("name")}
            />
            {errors.name ? (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor={`dept-desc-${department?.id ?? "new"}`}>
              Description <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id={`dept-desc-${department?.id ?? "new"}`}
              rows={3}
              placeholder="What this team is responsible for"
              aria-invalid={Boolean(errors.description)}
              {...register("description")}
            />
            {errors.description ? (
              <p className="text-sm text-destructive">{errors.description.message}</p>
            ) : null}
          </div>

          {serverError ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {serverError}
            </div>
          ) : null}

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : isEdit ? (
                "Save changes"
              ) : (
                "Create department"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Header action: create (ADMIN only — flag computed server-side). */
export function NewDepartmentButton({ canCreate }: { canCreate: boolean }) {
  if (!canCreate) return null;
  return (
    <DepartmentFormDialog
      trigger={
        <>
          <Plus className="size-4" aria-hidden />
          New department
        </>
      }
    />
  );
}

/** Per-row edit + delete. */
export function DepartmentRowActions({
  department,
  canUpdate,
  canDelete,
}: {
  department: DepartmentDto;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!canUpdate && !canDelete) return null;

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/departments/${department.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        // 409 is the expected "still has employees" case — surface it verbatim.
        const data = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setDeleteError(data?.message ?? "Unable to delete this department.");
        return;
      }

      setConfirmOpen(false);
      toast.success(`“${department.name}” deleted.`);
      router.refresh();
    } catch {
      setDeleteError("Network error. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {canUpdate ? (
        <DepartmentFormDialog
          department={department}
          trigger={
            <>
              <Pencil className="size-4" aria-hidden />
              <span className="sr-only">Edit {department.name}</span>
            </>
          }
        />
      ) : null}

      {canDelete ? (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              setDeleteError(null);
              setConfirmOpen(true);
            }}
          >
            <Trash2 className="size-4" aria-hidden />
            <span className="sr-only">Delete {department.name}</span>
          </Button>

          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete “{department.name}”?</DialogTitle>
                <DialogDescription>
                  This permanently removes the department. It will fail if employees are still
                  assigned to it — reassign them first.
                </DialogDescription>
              </DialogHeader>

              {deleteError ? (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {deleteError}
                </div>
              ) : null}

              <DialogFooter showCloseButton>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      Deleting…
                    </>
                  ) : (
                    "Delete department"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}
