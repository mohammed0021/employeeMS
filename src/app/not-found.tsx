import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center">
      <p className="text-5xl font-bold text-slate-300">404</p>
      <h1 className="text-xl font-semibold text-slate-800">Page not found</h1>
      <p className="max-w-md text-sm text-slate-500">
        The page you are looking for does not exist or may have been moved.
      </p>
      <Button variant="outline" render={<Link href="/dashboard" />}>
        Back to dashboard
      </Button>
    </div>
  );
}
