import { CHANNEL_LABELS, normaliseSettings, NOTIFICATION_EVENTS } from "@goinstall/core";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { saveNotificationSettingsAction } from "@/lib/actions/notifications";
import { asUser } from "@/lib/auth";
import { activeSms } from "@/lib/sms";

export const metadata = { title: "Notifications" };

export default async function NotificationSettingsPage() {
  const { settings, smsActive } = await asUser(async (tx, session) => {
    const c = await tx.selectFrom("companies").select("notification_settings").executeTakeFirstOrThrow();
    return { settings: normaliseSettings(c.notification_settings), smsActive: Boolean(await activeSms(tx, session.companyId)) };
  }, ["admin"]);
  const r = settings.reminders;
  return (
    <ActionForm action={saveNotificationSettingsAction} className="flex flex-col gap-6">
      {(["internal", "external"] as const).map((audience) => (
        <Card key={audience}>
          <CardHeader className="flex-col items-start">
            <CardTitle>{audience === "internal" ? "Your team" : "Your customers"}</CardTitle>
            <p className="text-sm text-ink-3">
              {audience === "internal" ? "Who hears about what, and how. Texts go to each person's mobile number in Team & permissions." : "Messages GoInstall sends customers for you. Texts go from your own number."}
              {!smsActive && (
                <>
                  {" "}
                  SMS needs the <Link href="/settings/sms">SMS add-on</Link>.
                </>
              )}
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[13px] text-ink-3">
                <tr>
                  <th className="py-2 font-semibold">Event</th>
                  {(audience === "internal" ? (["in_app", "email", "sms"] as const) : (["email", "sms"] as const)).map((c) => (
                    <th key={c} className="w-20 py-2 text-center font-semibold">
                      {CHANNEL_LABELS[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {NOTIFICATION_EVENTS.filter((e) => e.audience === audience).map((e) => (
                  <tr key={e.key} className="border-t border-divider">
                    <td className="py-2.5 pr-3">
                      <span className="block font-medium">{e.label}</span>
                      <span className="text-xs text-muted-foreground">To: {e.to}</span>
                    </td>
                    {(audience === "internal" ? (["in_app", "email", "sms"] as const) : (["email", "sms"] as const)).map((c) => (
                      <td key={c} className="py-2.5 text-center">
                        <input
                          type="checkbox"
                          name={`${e.key}:${c}`}
                          aria-label={`${e.label}: ${CHANNEL_LABELS[c]}`}
                          defaultChecked={settings.events[e.key]?.includes(c)}
                          disabled={c === "sms" && !smsActive}
                          className="size-4 accent-[var(--primary)]"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Customer reminders</CardTitle>
          <p className="text-sm text-ink-3">Sent once a day at about 9am. Leave a box blank to switch that reminder off; they&apos;re all off until you set them.</p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Online survey: days after sending" htmlFor="surveyDays" hint="If it isn't finished by then">
            <Input id="surveyDays" name="surveyDays" inputMode="numeric" defaultValue={r.surveyDays ?? ""} placeholder="Off" />
          </Field>
          <Field label="Proposal: days after sending" htmlFor="proposalDays" hint="Up to three, e.g. 3, 7, 14">
            <Input id="proposalDays" name="proposalDays" defaultValue={r.proposalDays.join(", ")} placeholder="Off" />
          </Field>
          <Field label="Install: days before" htmlFor="installDaysBefore" hint="1 = the day before">
            <Input id="installDaysBefore" name="installDaysBefore" inputMode="numeric" defaultValue={r.installDaysBefore ?? ""} placeholder="Off" />
          </Field>
        </CardContent>
      </Card>
      {!smsActive &&
        // Keep SMS choices that were made while the add-on was on (disabled boxes aren't submitted).
        NOTIFICATION_EVENTS.filter((e) => settings.events[e.key]?.includes("sms")).map((e) => <input key={e.key} type="hidden" name={`${e.key}:sms`} value="on" />)}
      <div>
        <SubmitButton>Save notification settings</SubmitButton>
      </div>
    </ActionForm>
  );
}
