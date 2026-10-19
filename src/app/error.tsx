"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Global error boundary (500s). Details are logged client-side for dev;
 * production UI shows only a generic message (no stack traces leak).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[error-boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center">
      <p className="text-5xl font-bold text-slate-300">500</p>
      <h1 className="text-xl font-semibold text-slate-800">
        Something went wrong
      </h1>
      <p className="max-w-md text-sm text-slate-500">
        An unexpected error occurred. You can try again — if the problem
        persists, contact support.
        {error.digest ? ` (ref: ${error.digest})` : ""}
      </p>
      <Button variant="outline" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
