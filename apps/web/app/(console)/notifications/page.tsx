import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PageHeader } from "@/components/domain";
import { Card, CardContent } from "@/components/ui/card";
import { markAllReadAction } from "@/lib/actions/notifications";
import { asUser } from "@/lib/auth";
import { cn, timeAgo } from "@/lib/utils";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const items = await asUser((tx, session) =>
    tx.selectFrom("notifications").select(["id", "title", "body", "read_at", "created_at"]).where("user_id", "=", session.userId).orderBy("created_at", "desc").limit(100).execute(),
  );
  const unread = items.filter((n) => !n.read_at).length;
  return (
    <>
      <PageHeader title="Notifications" description={unread ? `${unread} unread` : "You're up to date."} />
      <Card>
        <CardContent className="flex flex-col gap-3 pt-5">
          {unread > 0 && (
            <ActionForm action={markAllReadAction} className="self-end">
              <SubmitButton variant="outline" size="sm" pendingText="Marking…">
                Mark all as read
              </SubmitButton>
            </ActionForm>
          )}
          {items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing yet. New enquiries, signed proposals, payments and completed jobs show here.</p>
          ) : (
            <ul className="divide-y" aria-label="Notifications">
              {items.map((n) => (
                <li key={n.id}>
                  <Link href={`/notifications/open/${n.id}`} prefetch={false} className="flex gap-3 px-1 py-3 hover:bg-surface-subtle">
                    <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-primary")} />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm", n.read_at ? "text-ink-2" : "font-semibold")}>
                        {n.title}
                        {!n.read_at && <span className="sr-only"> (unread)</span>}
                      </span>
                      {n.body && <span className="block truncate text-[13px] text-ink-3">{n.body}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(n.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
