import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/guards";
import { ROLE_LABELS } from "@/components/layout/nav-config";

/**
 * Current session as seen by the client (nav, guards fallback).
 * Sensitive fields (passwordHash etc.) are never included — DTO only.
 */
export async function GET(): Promise<NextResponse> {
  const session = await currentSession();

  if (!session) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Please sign in." },
      { status: 401 },
    );
  }

  return NextResponse.json({
    user: {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role,
      roleLabel: ROLE_LABELS[session.user.role],
      employeeId: session.user.employeeId,
      employee: session.user.employee
        ? {
            id: session.user.employee.id,
            name: `${session.user.employee.firstName} ${session.user.employee.lastName}`,
          }
        : null,
    },
  });
}
