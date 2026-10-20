import { Mail, MessageCircle, Settings2, StickyNote } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/domain";
import { describeEvent } from "@/lib/events";
import { cn, formatDateTime } from "@/lib/utils";

export interface ThreadMessage {
  id: string;
  channel: "email" | "whatsapp" | "note" | "system";
  direction: "inbound" | "outbound" | "internal";
  subject: string | null;
  body: string;
  created_at: Date;
  sender: string | null;
}

export interface ThreadEvent {
  id: string;
  event: string;
  payload: unknown;
  created_at: Date;
  actor: string | null;
}

export const THREAD_TABS = [
  { key: "all", label: "All" },
  { key: "email", label: "Email" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "note", label: "Notes" },
] as const;
export type ThreadTab = (typeof THREAD_TABS)[number]["key"];

const ICONS = { email: Mail, whatsapp: MessageCircle, note: StickyNote, system: Settings2 };
const CHANNEL_LABELS = { email: "Email", whatsapp: "WhatsApp", note: "Note", system: "System" };

/** Unified thread: messages on every channel plus system events, newest first. */
export function Thread({ messages, events, tab, tabHref }: { messages: ThreadMessage[]; events: ThreadEvent[]; tab: ThreadTab; tabHref?: (t: ThreadTab) => string }) {
  type Item = { kind: "message"; at: Date; m: ThreadMessage } | { kind: "event"; at: Date; e: ThreadEvent };
  const items: Item[] = [
    ...messages.filter((m) => tab === "all" || m.channel === tab).map((m) => ({ kind: "message" as const, at: new Date(m.created_at), m })),
    ...(tab === "all" ? events.map((e) => ({ kind: "event" as const, at: new Date(e.created_at), e })) : []),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <div>
      {tabHref && (
      <nav aria-label="Message channels" className="flex gap-1 border-b px-2">
        {THREAD_TABS.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            scroll={false}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground",
              tab === t.key ? "border-primary text-foreground" : "border-transparent",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      )}
      <ol className="grid gap-3 p-4">
        {items.length === 0 && (
          <li>
            <EmptyState>{tab === "email" || tab === "whatsapp" ? "Email and WhatsApp arrive in phase 2." : "Nothing here yet."}</EmptyState>
          </li>
        )}
        {items.map((item) =>
          item.kind === "event" ? (
            <li key={`e-${item.e.id}`} className="flex items-center gap-2 text-xs text-muted-foreground">
              <Settings2 className="size-3.5 shrink-0" aria-hidden />
              <span>
                {describeEvent(item.e.event, item.e.payload)}
                {item.e.actor && ` by ${item.e.actor}`} · <time dateTime={item.at.toISOString()}>{formatDateTime(item.at)}</time>
              </span>
            </li>
          ) : (
            <MessageItem key={`m-${item.m.id}`} m={item.m} />
          ),
        )}
      </ol>
    </div>
  );
}

function MessageItem({ m }: { m: ThreadMessage }) {
  const Icon = ICONS[m.channel];
  const inbound = m.direction === "inbound";
  return (
    <li className={cn("rounded-lg border p-3 text-sm", m.channel === "note" ? "bg-amber-50" : inbound ? "bg-card" : "bg-secondary")}>
      <p className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        <span className="font-medium text-foreground">{CHANNEL_LABELS[m.channel]}</span>
        <span>{inbound ? "from customer" : m.sender ? `by ${m.sender}` : ""}</span>
        <time dateTime={new Date(m.created_at).toISOString()}>{formatDateTime(m.created_at)}</time>
      </p>
      {m.subject && <p className="font-medium">{m.subject}</p>}
      <p className="whitespace-pre-wrap">{m.body}</p>
    </li>
  );
}
