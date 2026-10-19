import Link from "next/link";
import { CalendarDays, Mail, Phone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EmployeeDto } from "@/lib/dto";

/**
 * Presentational detail card for one employee. Kept separate from the page so
 * the read path stays server-rendered and the JSX can be reused.
 *
 * `salary` arrives already redacted by `toEmployeeDto` (null for EMPLOYEE) —
 * this component never decides who may see compensation, it only renders what
 * the DTO handed it. A missing salary renders "Not visible" rather than 0.
 */
export function EmployeeDetail({ employee }: { employee: EmployeeDto }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Status</span>
            <EmployeeStatusBadge status={employee.status} />
          </div>
          <DetailRow label="Employee code" value={employee.employeeCode} mono />
          <DetailRow label="Position" value={employee.position} />
          <DetailRow
            label="Department"
            value={employee.department?.name ?? "Unassigned"}
          />
          <DetailRow label="Joined" value={employee.joinDate} mono />
          <DetailRow
            label="Salary"
            value={
              employee.salary === null ? (
                <span className="text-muted-foreground">Not visible</span>
              ) : (
                <span className="tabular-nums">{employee.salary}</span>
              )
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ContactRow icon={<Mail className="size-4" aria-hidden />} value={employee.email} />
          <ContactRow
            icon={<Phone className="size-4" aria-hidden />}
            value={employee.phone ?? "—"}
          />
          <ContactRow
            icon={<CalendarDays className="size-4" aria-hidden />}
            value={`Joined ${employee.joinDate}`}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-sm" : "text-sm font-medium"}>{value}</span>
    </div>
  );
}

function ContactRow({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

/** Shared status badge — mirrors the color logic used across modules. */
export function EmployeeStatusBadge({ status }: { status: EmployeeDto["status"] }) {
  const variant =
    status === "ACTIVE" ? "default" : status === "ON_LEAVE" ? "secondary" : "outline";
  return <Badge variant={variant}>{status.replace("_", " ")}</Badge>;
}

/** Convenience for detail pages linking back to the directory. */
export function BackToDirectory() {
  return (
    <Link
      href="/employees"
      className="text-sm text-muted-foreground hover:text-foreground"
    >
      ← Back to directory
    </Link>
  );
}
