import {
  Building2,
  FileText,
  History,
  LayoutDashboard,
  MessageSquare,
  Plane,
  QrCode,
  Settings,
  Sparkles,
  Table2,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { can, type Resource, type Role } from "@/lib/auth/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Resource checked via can(); items render only when readable. */
  resource: Resource;
  /** EMPLOYEE sees only own data — tag used for personal-section grouping. */
  personal?: boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

/**
 * Nav visibility mirrors the permission matrix for UX only.
 * Server-side authorization happens in every page/route handler via guards.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, resource: "dashboard" },
      { href: "/reports", label: "Reports", icon: Table2, resource: "reports" },
    ],
  },
  {
    label: "Workforce",
    items: [
      { href: "/employees", label: "Employees", icon: Users, resource: "employees" },
      { href: "/departments", label: "Departments", icon: Building2, resource: "departments" },
      { href: "/attendance", label: "Attendance", icon: QrCode, resource: "attendance" },
      { href: "/leave", label: "Leave requests", icon: Plane, resource: "leave" },
      { href: "/payroll", label: "Payroll", icon: Wallet, resource: "payroll" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/chat", label: "HR policy chatbot", icon: MessageSquare, resource: "chat" },
      { href: "/feedback", label: "Performance feedback", icon: Sparkles, resource: "feedback" },
      { href: "/attrition", label: "Attrition analytics", icon: TrendingUp, resource: "attrition" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/policies", label: "Policy documents", icon: FileText, resource: "policies" },
      { href: "/admin/users", label: "Users & roles", icon: Users, resource: "users" },
      { href: "/audit", label: "Audit logs", icon: History, resource: "audit" },
    ],
  },
];

export const UTILITY_NAV: NavItem[] = [
  { href: "/settings", label: "Profile & settings", icon: Settings, resource: "dashboard" },
  // Internal helper links rendered on their own pages, not in the sidebar:
  // /leave/approvals (approve), /feedback (create), /attendance (record).
];

/** Items the given role may see. */
export function navForRole(role: Role): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => can(role, item.resource, "read") || can(role, item.resource, "readOwn")),
  })).filter((group) => group.items.length > 0);
}

/** Convenience re-export so pages don't import two modules. */
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  HR: "Human Resources",
  EMPLOYEE: "Employee",
};
