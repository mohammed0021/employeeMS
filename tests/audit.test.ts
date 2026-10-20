/**
 * Audit trail: `recordAudit` sanitises metadata on the way in (no password /
 * token / secret keys ever reach the table) and the module is append-only BY
 * CONSTRUCTION — it exports exactly one writer and nothing that can mutate or
 * remove a row.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import * as audit from "@/lib/audit/audit";
import * as auditLogService from "@/lib/services/audit-log";
import { makeUser, runCleanups, uniqueId, type UserFixture } from "./helpers";

let actorUser!: UserFixture;

beforeAll(async () => {
  // `AuditLog.actorId` is a real FK to User (SetNull on delete) — the actor
  // must be a genuine account or the (silent) write would be rejected.
  actorUser = await makeUser({ role: "ADMIN" });
});

afterAll(async () => {
  await runCleanups();
});

describe("recordAudit sanitisation", () => {
  it("strips password/token/secret-shaped keys and keeps the rest", async () => {
    const entityId = uniqueId("audit");
    const action = `TEST_ACTION_${uniqueId("A")}`;

    await audit.recordAudit({
      actor: { id: actorUser.id, role: "ADMIN" },
      action,
      entityType: "TestEntity",
      entityId,
      outcome: "FAILURE",
      metadata: {
        keep: "yes",
        password: "hunter2",
        passwordHash: "scrypt$…",
        apiToken: "sk-live-…",
        apiKey: "key-…",
        secret: "shhh",
        authorization: "Bearer …",
        nestedNote: { password: "deep" }, // only TOP-LEVEL keys are filtered
      },
    });

    const row = await prisma.auditLog.findFirst({
      where: { action, entityId },
      orderBy: { createdAt: "desc" },
    });
    expect(row, "recordAudit must write the row").not.toBeNull();
    expect(row?.outcome).toBe("FAILURE");
    expect(row?.actorId).toBe(actorUser.id);
    expect(row?.actorRole).toBe("ADMIN");
    expect(row?.entityType).toBe("TestEntity");

    const metadata = row!.metadata as unknown as Record<string, unknown>;
    expect(metadata.keep).toBe("yes");
    expect(metadata.nestedNote).toEqual({ password: "deep" });
    for (const forbidden of [
      "password",
      "passwordHash",
      "apiToken",
      "apiKey",
      "secret",
      "authorization",
    ]) {
      expect(Object.keys(metadata), `${forbidden} must be stripped`).not.toContain(forbidden);
    }
    expect(JSON.stringify(metadata)).not.toContain("hunter2");
    expect(JSON.stringify(metadata)).not.toContain("sk-live-…");

    await prisma.auditLog.deleteMany({ where: { action, entityId } });
  });

  it("never throws when the write fails — auditing must not break requests", async () => {
    // An outcome outside the AuditOutcome enum fails at the database; the
    // writer logs and swallows instead of rejecting the caller's request.
    const invalid = {
      actor: { id: actorUser.id, role: "ADMIN" },
      action: "TEST_ACTION_INVALID_OUTCOME",
      entityType: "Test",
      outcome: "NOPE",
    } as unknown as Parameters<typeof audit.recordAudit>[0];

    await expect(audit.recordAudit(invalid)).resolves.toBeUndefined();
    expect(
      await prisma.auditLog.count({ where: { action: "TEST_ACTION_INVALID_OUTCOME" } }),
    ).toBe(0);
  });
});

describe("append-only by construction", () => {
  it("the audit module exports exactly one writer and no mutation helper", () => {
    const names = Object.keys(audit).sort();
    // Types (AuditActor, AuditEntry) are erased at runtime — only these exist.
    expect(names).toEqual(["AUDIT_ACTIONS", "recordAudit"]);
    expect(typeof audit.recordAudit).toBe("function");
    // Belt and braces: nothing shaped like an update/delete even exists.
    for (const name of names) {
      expect(name.toLowerCase()).not.toMatch(/update|delete|remove|truncate|patch/);
    }
  });

  it("the audit READ service is likewise read-only", () => {
    const names = Object.keys(auditLogService);
    expect(names).toEqual(["listAuditLogs"]);
    for (const name of names) {
      expect(name.toLowerCase()).not.toMatch(/update|delete|remove|truncate|patch|write|create/);
    }
  });

  it("exposes canonical action names (no typos to drift across modules)", () => {
    expect(audit.AUDIT_ACTIONS.SELF_ROLE_CHANGE_DENIED).toBe("SELF_ROLE_CHANGE_DENIED");
    expect(audit.AUDIT_ACTIONS.ATTENDANCE_CORRECTED).toBe("ATTENDANCE_CORRECTED");
    expect(new Set(Object.values(audit.AUDIT_ACTIONS)).size).toBe(
      Object.keys(audit.AUDIT_ACTIONS).length,
    );
  });
});
