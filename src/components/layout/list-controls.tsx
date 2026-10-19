import Link from "next/link";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Shared list-page chrome: search + pagination.
 *
 * Both are plain server-rendered HTML (a GET form and links) — no client JS,
 * and they work with the browser's back button and URL bar for free.
 *
 * Deliberate constraint: the search form submits ONLY `q`. It never emits an
 * empty-named parameter, because an empty `?status=` would reach a service as
 * a real (falsy-but-present) filter value. Anything else is expressed as a
 * link so it preserves the rest of the query string instead of replacing it.
 */

function buildHref(basePath: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Active search box. Submits `q`; the page resets to 1 by design. */
export function SearchForm({
  action,
  value = "",
  placeholder = "Search…",
  label = "Search",
}: {
  action: string;
  value?: string;
  placeholder?: string;
  label?: string;
}) {
  return (
    <form action={action} method="get" className="flex flex-wrap items-center gap-2">
      <Input
        type="search"
        name="q"
        defaultValue={value}
        placeholder={placeholder}
        aria-label={label}
        className="h-8 w-full max-w-xs"
      />
      <Button type="submit" variant="outline" size="sm">
        <Search className="size-4" aria-hidden />
        {label}
      </Button>
      {value ? (
        // Plain link: a second submit button would still post `q`.
        <Button render={<Link href={action} />} variant="ghost" size="sm">
          Clear
        </Button>
      ) : null}
    </form>
  );
}

/**
 * Previous/Next plus a total. `params` is the *current* query string — it is
 * cloned and only `page` is replaced, so an active search or filter survives
 * paging.
 */
export function PaginationNav({
  basePath,
  params,
  page,
  pages,
  total,
  itemLabel,
}: {
  basePath: string;
  params: URLSearchParams;
  page: number;
  pages: number;
  total: number;
  itemLabel: string;
}) {
  if (pages <= 1) return null;

  const hrefFor = (target: number) => {
    const next = new URLSearchParams(params.toString());
    if (target <= 1) next.delete("page");
    else next.set("page", String(target));
    return buildHref(basePath, next);
  };

  return (
    <nav aria-label={`${itemLabel} pages`} className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">
        Page {page} of {pages} · {total} {itemLabel}
        {total === 1 ? "" : "s"}
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Button render={<Link href={hrefFor(page - 1)} />} variant="outline" size="sm">
            Previous
          </Button>
        ) : null}
        {page < pages ? (
          <Button render={<Link href={hrefFor(page + 1)} />} variant="outline" size="sm">
            Next
          </Button>
        ) : null}
      </span>
    </nav>
  );
}
