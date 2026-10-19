import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth/guards";
import { LoginForm } from "@/components/auth/login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const session = await currentSession();
  if (session) redirect("/dashboard");

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      {/* useSearchParams requires a Suspense boundary in App Router */}
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
