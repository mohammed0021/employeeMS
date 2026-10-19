import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { hashPassword } from "../src/lib/auth/password";
import { requireDbUrl } from "../src/lib/db-url";

/**
 * Bootstrap the first ADMIN account.
 *
 * Usage:
 *   npm run create-admin                       # uses ADMIN_EMAIL / ADMIN_PASSWORD
 *   ADMIN_EMAIL=a@b.c ADMIN_PASSWORD=... npm run create-admin
 *
 * Idempotent: if the email already exists it resets that user to ADMIN and
 * rotates the password (safe to re-run). Prints the credentials it set — the
 * caller is responsible for changing the password after first login.
 */
async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "admin@example.com")
    .trim()
    .toLowerCase();
  const password =
    process.env.ADMIN_PASSWORD ?? "change-me-strong-password";

  if (password.length < 10) {
    throw new Error("ADMIN_PASSWORD must be at least 10 characters.");
  }

  const connectionString = requireDbUrl("pooled");
  const pool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 15_000,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.upsert({
    where: { email },
    update: { role: "ADMIN", status: "ACTIVE", passwordHash },
    create: { email, role: "ADMIN", status: "ACTIVE", passwordHash },
    select: { id: true, email: true, role: true, status: true },
  });

  console.log("Admin ready:");
  console.log(`  email:    ${user.email}`);
  console.log(`  role:     ${user.role}`);
  console.log(`  status:   ${user.status}`);
  console.log(`  id:       ${user.id}`);
  console.log(
    "\nNOTE: change this password after first login (Settings → Change password).",
  );

  await prisma.$disconnect();
  await pool.end();
}

main().catch((error) => {
  console.error("create-admin failed:", error);
  process.exit(1);
});
