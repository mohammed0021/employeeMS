import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center">
      <p className="text-5xl font-bold text-slate-300">403</p>
      <h1 className="text-xl font-semibold text-slate-800">
        You don&apos;t have access to this page
      </h1>
      <p className="max-w-md text-sm text-slate-500">
        Your account role does not include permission for this area. If you
        believe this is a mistake, contact an administrator.
      </p>
      <Button variant="outline" render={<Link href="/dashboard" />}>
        Back to dashboard
      </Button>
    </div>
  );
}
