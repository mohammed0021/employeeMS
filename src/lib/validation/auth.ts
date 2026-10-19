import { z } from "zod";
import { PASSWORD_POLICY } from "@/lib/auth/password";
import { ROLES } from "@/lib/auth/permissions";

const email = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email()
  .transform((v) => v.toLowerCase());

const password = z
  .string()
  .min(PASSWORD_POLICY.minLength, `Password must be at least ${PASSWORD_POLICY.minLength} characters.`)
  .max(PASSWORD_POLICY.maxLength);

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Password is required.").max(PASSWORD_POLICY.maxLength),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(PASSWORD_POLICY.maxLength),
    newPassword: password,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "New password must differ from the current one.",
    path: ["newPassword"],
  });

/** Admin creates users (never self-registration). */
export const createUserSchema = z.object({
  email,
  password,
  role: z.enum(ROLES),
  employeeId: z.string().cuid().optional(),
});

export const updateUserSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
    password: password.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Nothing to update.",
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
