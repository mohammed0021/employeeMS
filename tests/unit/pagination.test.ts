import { describe, expect, it } from "vitest";
import {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  paginated,
  parseListQuery,
  resolveSort,
  toUrlSearchParams,
} from "@/lib/pagination";

const qs = (value: string) => new URLSearchParams(value);

describe("parseListQuery bounds", () => {
  it("applies defaults when params are absent", () => {
    expect(parseListQuery(qs(""))).toEqual({
      page: 1,
      limit: PAGE_SIZE_DEFAULT,
      q: undefined,
    });
  });

  it("rejects an oversized limit instead of trusting it", () => {
    expect(parseListQuery(qs("limit=5000")).limit).toBe(PAGE_SIZE_DEFAULT);
    expect(parseListQuery(qs("limit=100")).limit).toBe(100);
    expect(parseListQuery(qs("limit=0")).limit).toBe(PAGE_SIZE_DEFAULT);
    expect(parseListQuery(qs("limit=abc")).limit).toBe(PAGE_SIZE_DEFAULT);
  });

  it("never allows page < 1", () => {
    expect(parseListQuery(qs("page=0")).page).toBe(1);
    expect(parseListQuery(qs("page=-3")).page).toBe(1);
    expect(parseListQuery(qs("page=xyz")).page).toBe(1);
    expect(parseListQuery(qs("page=4")).page).toBe(4);
  });

  it("trims the search term", () => {
    expect(parseListQuery(qs("q=%20%20engineer%20")).q).toBe("engineer");
  });
});

describe("resolveSort allow-list (sort-column injection guard)", () => {
  const allowed = new Set(["date", "lastName"]);

  it("returns a permitted column", () => {
    expect(resolveSort(qs("sort=lastName&dir=asc"), allowed, "date")).toEqual({
      field: "lastName",
      dir: "asc",
    });
  });

  it("falls back for columns outside the allow-list", () => {
    const result = resolveSort(qs("sort=passwordHash"), allowed, "date");
    expect(result.field).toBe("date");
  });

  it("falls back when sort is absent or repeated", () => {
    expect(resolveSort(qs(""), allowed, "date").field).toBe("date");
    expect(resolveSort(qs("sort=password;DROP TABLE users"), allowed, "date").field).toBe("date");
  });

  it("normalizes direction to asc|desc only", () => {
    expect(resolveSort(qs("dir=asc"), allowed, "date").dir).toBe("asc");
    expect(resolveSort(qs("dir=DESC"), allowed, "date").dir).toBe("desc");
    expect(resolveSort(qs("dir=sideways"), allowed, "date").dir).toBe("desc");
  });
});

describe("paginated envelope", () => {
  it("reports at least one page even with no rows", () => {
    const envelope = paginated([], 0, { page: 1, limit: 20, q: undefined });
    expect(envelope).toMatchObject({ items: [], total: 0, pages: 1, page: 1 });
  });

  it("rounds pages up", () => {
    const envelope = paginated([{}], 45, { page: 3, limit: 20, q: undefined });
    expect(envelope.pages).toBe(3);
    expect(envelope.pageSize).toBe(20);
    expect(envelope.total).toBe(45);
  });

  it("stays consistent for an exact multiple", () => {
    expect(paginated([], 40, { page: 1, limit: 20, q: undefined }).pages).toBe(2);
  });
});

describe("toUrlSearchParams", () => {
  it("handles the shapes Next passes as searchParams", () => {
    const params = toUrlSearchParams({
      q: "engineer",
      page: "2",
      tags: ["a", "b"],
      missing: undefined,
    });
    expect(params.get("q")).toBe("engineer");
    expect(params.get("page")).toBe("2");
    expect(params.getAll("tags")).toEqual(["a", "b"]);
    expect(params.has("missing")).toBe(false);
  });

  it("round-trips through parseListQuery", () => {
    expect(parseListQuery(toUrlSearchParams({ page: "3", limit: "10" }))).toEqual({
      page: 3,
      limit: 10,
      q: undefined,
    });
  });
});
