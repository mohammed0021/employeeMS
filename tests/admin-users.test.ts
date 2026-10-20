/**
 * Admin user management: account creation + real login verification, the
 * duplicate/weak-password guards, the self-role-change lockout (audited as a
 * FAILURE before the 403), and password reset killing every live session.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/errors";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, getSession } from "@/lib/auth/session";
import { AUDIT_ACTIONS } from "@/lib/audit/audit";
import { createUser, resetPassword, updateUser } from "@/lib/services/admin-users";
import type { CreateUserInput } from "@/lib/validation/admin";
import { createUserSchema, resetPasswordSchema } from "@/lib/validation/admin";
import {
  actorFor,
  expectAppError,
  makeUser,
  runCleanups,
  trackUser,
  uniqueId,
  type UserFixture,
} from "./helpers";

let admin!: UserFixture;
let hr!: UserFixture;

beforeAll(async () => {
  admin = await makeUser({ role: "ADMIN" });
  hr = await makeUser({ role: "HR" });
});

afterAll(async () => {
  await runCleanups();
});

const STRONG = "Sunset-Run-2026x";

describe("createUser + login", () => {
  it("creates an account whose password verifies and which can log in", async () => {
    const email = `new-${uniqueId("n")}@example.test`;
    const dto = await createUser(
      { email, role: "EMPLOYEE", password: STRONG },
      actorFor(admin),
    );
    // Service-created, so `makeUser` never saw it: register its cleanup here.
    trackUser(dto.id);

    // The DTO shape is built field-by-field — the hash can never ride along.
    expect(dto.email).toBe(email);
    expect(dto.role).toBe("EMPLOYEE");
    expect(dto.status).toBe("ACTIVE");
    expect(Object.keys(dto)).not.toContain("passwordHash");
    expect(dto.employee).toBeNull();

    // What POST /api/auth/login does: load the row, verify the password.
    const row = await prisma.user.findUnique({ where: { email } });
    expect(row).not.toBeNull();
    expect(row!.passwordHash).not.toContain(STRONG);
    expect(await verifyPassword(STRONG, row!.passwordHash)).toBe(true);
    expect(await verifyPassword("wrong-password-1", row!.passwordHash)).toBe(false);

    // ...then mints a session the cookie token resolves to.
    const { token } = await createSession(row!.id);
    const session = await getSession(token);
    expect(session).not.toBeNull();
    expect(session!.user.email).toBe(email);
    expect(session!.user.role).toBe("EMPLOYEE");
    // A tampered/unknown token resolves to nothing.
    expect(await getSession(`${token}tampered`)).toBeNull();
  });

  it("maps a duplicate email to 409 CONFLICT", async () => {
    const email = `dup-${uniqueId("d")}@example.test`;
    const input: CreateUserInput = { email, role: "EMPLOYEE", password: STRONG };
    const created = await createUser(input, actorFor(admin));
    trackUser(created.id);
    await expectAppError(createUser(input, actorFor(admin)), 409, "CONFLICT");
  });

  it("rejects a weak password with 400 VALIDATION_ERROR and writes nothing", async () => {
    const email = `weak-${uniqueId("w")}@example.test`;
    const weak = { email, role: "EMPLOYEE" as const, password: "short" };

    // The service takes pre-parsed input — the schema is the gate, and the
    // route's apiHandler maps its ZodError to the 400 the client sees.
    expect(createUserSchema.safeParse(weak).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ password: "123456789" }).success).toBe(false);

    const response = await apiHandler(async () => {
      createUserSchema.parse(weak);
      return new Response("unreachable");
    })();
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; fields?: unknown[] };
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.fields?.length).toBeGreaterThan(0);

    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it("denies non-ADMIN actors with 403", async () => {
    await expectAppError(
      createUser(
        { email: `hr-${uniqueId("h")}@example.test`, role: "EMPLOYEE", password: STRONG },
        actorFor(hr),
      ),
      403,
      "FORBIDDEN",
    );
  });
});

describe("self role-change guard", () => {
  it("denies an admin changing their OWN role with 403 AND audits the FAILURE", async () => {
    const error = await expectAppError(
      updateUser(admin.id, { role: "HR" }, actorFor(admin)),
      403,
      "FORBIDDEN",
    );
    expect(error.message).toMatch(/your own role/i);

    // Nothing changed.
    const row = await prisma.user.findUnique({ where: { id: admin.id } });
    expect(row?.role).toBe("ADMIN");

    // The denied attempt is on the trail, outcome FAILURE, before the throw.
    const audit = await prisma.auditLog.findFirst({
      where: {
        action: AUDIT_ACTIONS.SELF_ROLE_CHANGE_DENIED,
        outcome: "FAILURE",
        entityId: admin.id,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit, "the denied attempt must be audited").not.toBeNull();
    expect(audit?.actorId).toBe(admin.id);
    expect(audit?.entityType).toBe("User");
    expect(audit?.metadata).toMatchObject({ from: "ADMIN", to: "HR" });
  });

  it("still allows an admin to change SOMEONE ELSE's role (audited)", async () => {
    const target = await makeUser({ role: "EMPLOYEE" });
    const dto = await updateUser(target.id, { role: "HR" }, actorFor(admin));
    expect(dto.role).toBe("HR");

    const audit = await prisma.auditLog.findFirst({
      where: { action: AUDIT_ACTIONS.USER_ROLE_CHANGE, entityId: target.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.metadata).toMatchObject({ from: "EMPLOYEE", to: "HR" });
  });

  it("denies HR from user management entirely", async () => {
    const target = await makeUser({ role: "EMPLOYEE" });
    await expectAppError(updateUser(target.id, { role: "HR" }, actorFor(hr)), 403, "FORBIDDEN");
  });
});

describe("resetPassword", () => {
  it("rotates the hash, invalidates the OLD password and deletes every session", async () => {
    const target = await makeUser({ password: "Original-Pass1" });

    // Sessions minted before the reset — created directly via prisma, the way
    // an already-issued cookie row exists in production.
    const expiresAt = new Date(Date.now() + 7 * 24 * 3_600_000);
    await prisma.session.create({
      data: { tokenHash: `before-1-${uniqueId("s")}`, userId: target.id, expiresAt },
    });
    await prisma.session.create({
      data: { tokenHash: `before-2-${uniqueId("s")}`, userId: target.id, expiresAt },
    });
    expect(
      await prisma.session.count({ where: { userId: target.id } }),
    ).toBe(2);

    const replacement = "Breeze-Window-2026x";
    await resetPassword(target.id, { password: replacement }, actorFor(admin));

    // Every session for that user is gone — old cookies die immediately.
    expect(
      await prisma.session.count({ where: { userId: target.id } }),
    ).toBe(0);

    const row = await prisma.user.findUnique({ where: { id: target.id } });
    expect(row).not.toBeNull();
    expect(await verifyPassword("Original-Pass1", row!.passwordHash)).toBe(false);
    expect(await verifyPassword(target.password, row!.passwordHash)).toBe(false);
    expect(await verifyPassword(replacement, row!.passwordHash)).toBe(true);

    // The audit entry records the reset as a flag — never the password itself.
    const audit = await prisma.auditLog.findFirst({
      where: { action: AUDIT_ACTIONS.USER_UPDATED, entityId: target.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.metadata).toMatchObject({ passwordReset: true });
    expect(JSON.stringify(audit?.metadata)).not.toContain(replacement);
    expect(JSON.stringify(audit?.metadata)).not.toContain(target.password);
  });

  it("applies the same password policy an end user would face", async () => {
    expect(resetPasswordSchema.safeParse({ password: "abc" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ password: "NoDigitsHereAtAll!" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ password: STRONG }).success).toBe(true);
    // And hashing stays in the shared module — the service never sees a hash.
    expect(typeof (await hashPassword(STRONG))).toBe("string");
  });
});
