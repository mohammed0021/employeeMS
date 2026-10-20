/**
 * Password module against the real crypto path (scrypt, OWASP parameters).
 * No database rows are created — this file only exercises the auth helpers.
 */
import { describe, expect, it } from "vitest";
import {
  PASSWORD_POLICY,
  hashPassword,
  verifyPassword,
} from "@/lib/auth/password";

describe("hashPassword / verifyPassword", () => {
  it("round-trips the correct password", async () => {
    const hash = await hashPassword("Correct-Horse-9");
    expect(await verifyPassword("Correct-Horse-9", hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("Correct-Horse-9");
    expect(await verifyPassword("correct-horse-9", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
    expect(await verifyPassword("Correct-Horse-9 ", hash)).toBe(false);
  });

  it("never stores the plaintext and salts every hash differently", async () => {
    const plaintext = "Sup3rSecretPass!";
    const first = await hashPassword(plaintext);
    const second = await hashPassword(plaintext);

    expect(first).not.toContain(plaintext);
    expect(second).not.toContain(plaintext);
    // Same input, different salt → different stored strings.
    expect(first).not.toBe(second);
    // Format documented in password.ts: scrypt$N$r$p$salt$hash.
    expect(first.split("$")).toHaveLength(6);
    expect(first.startsWith("scrypt$")).toBe(true);
  });

  it("returns false for malformed hashes instead of throwing", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(await verifyPassword("anything", "scrypt$1$2$3$AAAA")).toBe(false);
    expect(await verifyPassword("anything", "bcrypt$32768$8$1$AAAA$AAAA")).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
  });

  it("enforces the documented minimum password policy", () => {
    expect(PASSWORD_POLICY.minLength).toBe(10);
    expect(PASSWORD_POLICY.maxLength).toBe(128);
  });
});
