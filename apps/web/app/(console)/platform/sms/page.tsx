import { withService } from "@goinstall/db";
import { PageHeader } from "@/components/domain";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/platform";
import { smsService } from "@/lib/sms";
import { formatDate } from "@/lib/utils";
import { AttachNumber } from "./numbers";

export const metadata = { title: "SMS numbers (GoInstall)" };

/** GoInstall staff: companies on the SMS add-on, and attaching their numbers once Twilio approves them. */
export default async function PlatformSmsPage() {
  await requirePlatformAdmin();
  const accounts = await withService(db(), (tx) =>
    tx
      .selectFrom("sms_accounts as s")
      .innerJoin("companies as c", "c.id", "s.company_id")
      .select(["s.company_id", "s.status", "s.phone_number", "s.business_details", "s.created_at", "s.activated_at", "c.name"])
      .where("s.status", "!=", "checkout")
      .orderBy("s.status")
      .orderBy("s.created_at")
      .execute(),
  );
  const fake = smsService()?.name === "recording";
  return (
    <>
      <PageHeader title="SMS numbers" description="GoInstall staff only. For each company waiting: create its regulatory bundle in Twilio from the details below, then attach a number once it's approved." />
      <div className="flex flex-col gap-4">
        {accounts.length === 0 && <p className="text-sm text-muted-foreground">No companies on the SMS add-on yet.</p>}
        {accounts.map((a) => {
          const d = a.business_details as Record<string, string>;
          return (
            <Card key={a.company_id}>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>{a.name}</CardTitle>
                <Badge variant={a.status === "active" ? "success" : a.status === "pending_number" ? "warning" : "default"}>{a.status.replace("_", " ")}</Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                {a.phone_number ? (
                  <p>
                    Number <span className="font-semibold">{a.phone_number}</span>
                    {a.activated_at ? ` since ${formatDate(a.activated_at, { day: "numeric", month: "short", year: "numeric" })}` : ""}
                  </p>
                ) : (
                  <>
                    {d.legalName ? (
                      <dl className="grid gap-1 sm:grid-cols-2">
                        {[
                          ["Business", d.legalName],
                          ["Company number", d.companyNumber || "—"],
                          ["Address", d.address],
                          ["Contact", [d.contactName, d.contactEmail, d.contactPhone].filter(Boolean).join(" · ")],
                        ].map(([k, v]) => (
                          <div key={k}>
                            <dt className="text-xs text-ink-3">{k}</dt>
                            <dd>{v}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="text-warning-text">Waiting for the company to send its business details.</p>
                    )}
                    {(a.status === "pending_number" || a.status === "active") && <AttachNumber companyId={a.company_id} fake={fake} />}
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
