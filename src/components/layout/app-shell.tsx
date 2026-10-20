import { Sidebar, SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ROLE_LABELS } from "./nav-config";
import { SidebarNav } from "./sidebar-nav";
import { SignOutButton } from "./sign-out-button";
import type { Role } from "@/lib/auth/permissions";
/**
 * Authenticated app shell: sidebar (role-filtered) + topbar.
 * The dashboard layout passes the session role resolved server-side.
 */
export function AppShell({
  role,
  userLabel,
  children,
}: {
  role: Role;
  userLabel: string;
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <span className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
            E
          </span>
          <span className="truncate text-sm font-semibold group-data-[collapsible=icon]:hidden">
            EMS
          </span>
        </div>
        <SidebarNav role={role} />
      </Sidebar>

      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {userLabel}
            </span>
            <Badge variant="secondary">{ROLE_LABELS[role]}</Badge>
            <Separator orientation="vertical" className="h-4" />
            <SignOutButton />
          </div>
        </header>
        <main className="flex-1 bg-slate-50/60 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
