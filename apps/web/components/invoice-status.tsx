import { Badge } from "@/components/ui/badge";

export function InvoiceStatus({ status, overdue }: { status: string; overdue: boolean }) {
  if (status === "paid") return <Badge variant="success">Paid</Badge>;
  if (status === "void") return <Badge>Void</Badge>;
  return <Badge variant="warning">{overdue ? "Overdue" : "Unpaid"}</Badge>;
}
