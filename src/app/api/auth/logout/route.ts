import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit/audit";
import { currentSession } from "@/lib/auth/guards";
import { revokeSession, SESSION_COOKIE } from "@/lib/auth/session";

export async function POST(): Promise<NextResponse> {
  const session = await currentSession();
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  await revokeSession(token);

  if (session) {
    await recordAudit({
      actor: { id: session.user.id, role: session.user.role },
      action: AUDIT_ACTIONS.LOGOUT,
      entityType: "Session",
      entityId: session.sessionId,
    });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
