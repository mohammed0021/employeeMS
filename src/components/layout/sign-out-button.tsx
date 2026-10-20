"use client";

import { useState } from "react";
import { LogOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Sign-out control for the app shell topbar.
 *
 * Calls the logout route, which revokes the session server-side (the token
 * row is deleted, not just the cookie) and writes the LOGOUT audit entry —
 * clearing the cookie alone would leave a stolen token valid until expiry,
 * so the server call is the load-bearing part and the redirect only happens
 * after it succeeds. On failure the user stays signed in and sees the error
 * rather than a page that looks logged out but is not.
 */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        setBusy(false);
        return;
      }
      // Hard navigation: the session cookie is gone, so every cached RSC
      // payload for the now-stale user must be discarded, not reused.
      window.location.assign("/login");
    } catch {
      setBusy(false);
    }
    // `busy` intentionally stays true on the success path — the page is gone.
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={signOut}
      disabled={busy}
      aria-label="Sign out"
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <LogOut className="size-4" aria-hidden />
      )}
      <span className="ml-2 hidden sm:inline">Sign out</span>
    </Button>
  );
}
