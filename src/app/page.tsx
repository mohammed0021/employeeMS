import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth/guards";

/** Root: signed in → dashboard, else → login (proxy also handles this). */
export default async function Home() {
  const session = await currentSession();
  redirect(session ? "/dashboard" : "/login");
}
