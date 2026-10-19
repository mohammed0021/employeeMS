import { prisma } from "@/lib/prisma";
import { errors } from "@/lib/errors";

/**
 * DB-backed fixed-window rate limiter.
 *
 * In-memory counters do not work across serverless instances, so windows are
 * counted in Postgres. Windows roll over lazily on read/write.
 */
export async function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const now = new Date();
  const bucket = await prisma.rateLimitBucket.findUnique({ where: { key } });

  if (!bucket || now.getTime() - bucket.windowStart.getTime() >= windowMs) {
    await prisma.rateLimitBucket.upsert({
      where: { key },
      create: { key, windowStart: now, count: 1 },
      update: { windowStart: now, count: 1 },
    });
    return;
  }

  if (bucket.count >= limit) {
    throw errors.rateLimited();
  }

  await prisma.rateLimitBucket.update({
    where: { key },
    data: { count: { increment: 1 } },
  });
}

export const RATE_LIMITS = {
  /** Login attempts per IP+email per 15 minutes (FR01 / security plan). */
  login: { limit: 5, windowMs: 15 * 60 * 1000 },
  /** Writes per authenticated user per minute (API abuse protection). */
  writes: { limit: 60, windowMs: 60 * 1000 },
} as const;

export function loginKey(ip: string, email: string): string {
  return `login:${ip}:${email.toLowerCase()}`;
}

export function writeKey(userId: string): string {
  return `write:${userId}`;
}
