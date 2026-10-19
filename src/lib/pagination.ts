/**
 * Shared list-query parsing for every paginated endpoint.
 *
 * Keeps bounds sane (no `?limit=100000` against Neon), gives all modules the
 * same `{ items, page, pages, total }` envelope, and returns sort values only
 * after checking them against an allow-list — callers never interpolate a raw
 * query param into `orderBy`, which would be a sort-column injection.
 */
import { z } from "zod";

export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;

/** Query-string shape shared by every list endpoint. */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).catch(PAGE_SIZE_DEFAULT),
  q: z.string().trim().max(100).optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

/** Parse `request.nextUrl.searchParams` into a bounded list query. */
export function parseListQuery(params: URLSearchParams): ListQuery {
  return listQuerySchema.parse({
    page: params.get("page") ?? undefined,
    limit: params.get("limit") ?? undefined,
    q: params.get("q") ?? undefined,
  });
}

/**
 * Next's page `searchParams` (`Promise<{ [k]: string | string[] | undefined }>`)
 * into a `URLSearchParams`, so pages can reuse the exact same parsing as the
 * API routes instead of each hand-rolling it.
 */
export function toUrlSearchParams(
  raw: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) for (const item of value) params.append(key, item);
  }
  return params;
}

export function offset(query: ListQuery): number {
  return (query.page - 1) * query.limit;
}

/**
 * Resolve a sort request against an allow-list of column names.
 *
 * Returns a column name guaranteed to be in `allowed` (unknown or malicious
 * input falls back to `fallback`) plus a normalized direction. Callers map
 * the returned column to a Prisma `orderBy` clause themselves, so a raw query
 * param never reaches the query builder.
 */
export function resolveSort(
  params: URLSearchParams,
  allowed: ReadonlySet<string>,
  fallback: string,
): { field: string; dir: "asc" | "desc" } {
  const raw = params.get("sort");
  const field = raw !== null && allowed.has(raw) ? raw : fallback;
  const dir = params.get("dir") === "asc" ? "asc" : "desc";
  return { field, dir };
}

/** Build the standard pagination envelope. */
export function paginated<T>(items: T[], total: number, query: ListQuery) {
  return {
    items,
    page: query.page,
    pageSize: query.limit,
    total,
    pages: Math.max(1, Math.ceil(total / query.limit)),
  };
}
