import { z } from "zod";

/** Department names are unique (DB `@unique`); keep input trimming consistent. */
const name = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters.")
  .max(80, "Name must be 80 characters or fewer.");

const description = z
  .string()
  .trim()
  .max(500, "Description must be 500 characters or fewer.");

export const createDepartmentSchema = z.object({
  name,
  description: description.optional(),
});

/** At least one field must change — an empty PATCH is a client bug, not a no-op 200. */
export const updateDepartmentSchema = z
  .object({
    name: name.optional(),
    description: description.nullable().optional(),
  })
  .refine(
    (value) => Object.values(value).some((v) => v !== undefined),
    { message: "Nothing to update.", path: ["name"] },
  );

/** List query: free-text search + pagination. */
export const departmentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  limit: z.coerce.number().int().min(1).max(100).catch(20),
  q: z.string().trim().max(100).optional(),
});

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;
