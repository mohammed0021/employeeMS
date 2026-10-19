import { Metadata } from "next";
import Link from "next/link";

import { PayrollStatusBadge } from "@/components/payroll/payroll-actions";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { pagePermissionAny, pageService } from "@/lib/auth/page-guards";
import { getPayroll, payrollActorFrom } from "@/lib/services/payroll";

export const metadata: Metadata = { title: "Payslip" };

type Props = { params: Promise<{ id: string }> };

export default async function PayslipPage({ params }: Props) {
  const { id } = await params;
  // ADMIN/HR hold `read`, EMPLOYEE only `readOwn` — a single-action guard here
  // would lock admins out of every payslip, so both are accepted and the
  // ownership check happens in the service (row-level, not UI-level).
  const session = await pagePermissionAny("payroll", "read", "readOwn");

  // The service returns 403 for another employee's record and 404 for an
  // unknown id; pageService turns those into the proper pages rather than 500s.
  const record = await pageService(() => getPayroll(id, payrollActorFrom(session)));

  const period = `${String(record.month).padStart(2, "0")}/${record.year}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Payslip · ${period}`}
        description={`${record.employee?.fullName ?? "Employee"}${
          record.employee?.employeeCode ? ` · ${record.employee.employeeCode}` : ""
        }`}
        actions={
          <div className="flex items-center gap-2">
            <Button render={<Link href="/payroll" />} variant="outline" size="sm">
              Back to payroll
            </Button>
            <Button render={<Link href={`/employees/${record.employeeId}`} />} variant="outline" size="sm">
              Employee record
            </Button>
          </div>
        }
      />

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Status:</span>
        <PayrollStatusBadge status={record.status} />
        {record.finalizedAt ? (
          <span>· finalized {record.finalizedAt.slice(0, 10)}</span>
        ) : (
          <span>· draft, editable until finalized</span>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Basic pay</TableCell>
                <TableCell className="text-right tabular-nums">
                  {record.baseSalary}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Bonus</TableCell>
                <TableCell className="text-right tabular-nums">
                  {record.bonus}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Deduction</TableCell>
                <TableCell className="text-right tabular-nums text-destructive">
                  −{record.deduction}
                </TableCell>
              </TableRow>
              <TableRow className="bg-muted/40">
                <TableCell className="font-semibold">Gross pay</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {record.grossPay}
                </TableCell>
              </TableRow>
              <TableRow className="bg-muted/40">
                <TableCell className="font-semibold">Net pay</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {record.netPay}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Basic academic implementation — figures are computed from stored salary
        components and are not a certified payroll statement or tax document.
      </p>
    </div>
  );
}
