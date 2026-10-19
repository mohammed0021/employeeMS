import { NextResponse } from "next/server";
import { ZodError } from "zod";

/**
 * Application error with an explicit HTTP status and a safe, user-facing code.
 * Never put secrets or raw DB errors in `code`/`message`.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AppError";
  }
}

export const errors = {
  unauthorized: () => new AppError(401, "UNAUTHORIZED", "Please sign in."),
  forbidden: (message?: string) =>
    new AppError(403, "FORBIDDEN", message ?? "You do not have access to this resource."),
  notFound: (message?: string) =>
    new AppError(404, "NOT_FOUND", message ?? "Resource not found."),
  conflict: (message: string) => new AppError(409, "CONFLICT", message),
  validation: (message: string) => new AppError(400, "VALIDATION_ERROR", message),
  rateLimited: (message?: string) =>
    new AppError(429, "RATE_LIMITED", message ?? "Too many attempts. Try again later."),
  aiUnavailable: (code: string, message: string) => new AppError(503, code, message),
  internal: () => new AppError(500, "INTERNAL_ERROR", "Something went wrong."),
};

/**
 * Wraps a route handler with uniform error handling:
 *  - ZodError        → 400 VALIDATION_ERROR (field messages only)
 *  - AppError        → its own status/code
 *  - unknown error   → 500 generic (details logged server-side only)
 */
export function apiHandler<T extends unknown[]>(
  handler: (...args: T) => Promise<Response>,
): (...args: T) => Promise<Response> {
  return async (...args: T): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ZodError) {
        return NextResponse.json(
          {
            code: "VALIDATION_ERROR",
            message: "Invalid request.",
            fields: error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
          { status: 400 },
        );
      }

      if (error instanceof AppError) {
        return NextResponse.json(
          { code: error.code, message: error.message },
          { status: error.status },
        );
      }

      // Log real error server-side; never leak internals to the client.
      console.error("[api] unhandled error:", error);
      return NextResponse.json(
        { code: "INTERNAL_ERROR", message: "Something went wrong." },
        { status: 500 },
      );
    }
  };
}
