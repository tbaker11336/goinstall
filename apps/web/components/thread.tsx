import { Check, Mail, MessageCircle, Settings2, StickyNote } from "lucide-react";
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
  delivery_status?: string | null;
  delivery_error?: string | null;
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

/**
 * Unified thread: messages on every channel plus system events. "chat" (the
 * contact page) reads oldest to newest with bubbles; "feed" (project
 * activity) is a newest-first list.
 */
export function Thread({
  messages,
  events,
  tab,
  tabHref,
  variant = "chat",
}: {
  messages: ThreadMessage[];
  events: ThreadEvent[];
  tab: ThreadTab;
  tabHref?: (t: ThreadTab) => string;
  variant?: "chat" | "feed";
}) {
  type Item = { kind: "message"; at: Date; m: ThreadMessage } | { kind: "event"; at: Date; e: ThreadEvent };
  const items: Item[] = [
    ...messages.filter((m) => tab === "all" || m.channel === tab).map((m) => ({ kind: "message" as const, at: new Date(m.created_at), m })),
    ...(tab === "all" ? events.map((e) => ({ kind: "event" as const, at: new Date(e.created_at), e })) : []),
  ].sort((a, b) => (variant === "chat" ? a.at.getTime() - b.at.getTime() : b.at.getTime() - a.at.getTime()));

  if (variant === "feed") {
    return (
      <ol className="flex flex-col gap-4 px-5 pt-1 pb-2">
        {items.length === 0 && <li className="text-sm text-muted-foreground">No activity yet.</li>}
        {items.map((item) => {
          const [text, who, dot] =
            item.kind === "event"
              ? [describeEvent(item.e.event, item.e.payload), item.e.actor, "bg-[#98a2b3]"]
              : [item.m.body, item.m.sender, item.m.channel === "note" ? "bg-info" : "bg-success"];
          return (
            <li key={item.kind === "event" ? `e-${item.e.id}` : `m-${item.m.id}`} className="flex gap-3">
              <span className={cn("mt-[7px] size-2 shrink-0 rounded-full", dot)} aria-hidden />
              <div className="flex flex-col gap-0.5">
                <p className="text-sm whitespace-pre-wrap">
                  {who && <strong className="font-semibold">{who} </strong>}
                  {item.kind === "message" && item.m.channel === "note" && who ? <span className="text-ink-3">added a note: </span> : null}
                  {text}
                </p>
                <time dateTime={item.at.toISOString()} className="text-[13px] text-muted-foreground">
                  {formatDateTime(item.at)}
                </time>
              </div>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <div>
      {tabHref && (
      <nav aria-label="Message channels" className="flex border-b px-5 pt-1">
        {THREAD_TABS.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            scroll={false}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "-mb-px mr-[22px] border-b-2 px-0.5 py-3 text-sm font-medium text-ink-3 hover:text-foreground",
              tab === t.key ? "border-primary font-semibold text-foreground" : "border-transparent",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      )}
      <ol className="flex min-h-[420px] flex-col gap-[18px] bg-[#fcfcfd] p-6 max-md:p-4">
        {items.length === 0 && (
          <li>
            <EmptyState>{tab === "email" || tab === "whatsapp" ? "Email and WhatsApp arrive in phase 2." : "Nothing here yet."}</EmptyState>
          </li>
        )}
        {items.map((item) =>
          item.kind === "event" ? (
            <li key={`e-${item.e.id}`} className="inline-flex max-w-full items-center gap-2 self-center rounded-full bg-success-tint px-3 py-1.5 text-[12.5px] font-semibold text-success-text">
              <Check className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
              <span>
                {describeEvent(item.e.event, item.e.payload)}
                {item.e.actor && ` by ${item.e.actor}`} · <time dateTime={item.at.toISOString()}>{formatDateTime(item.at)}</time>
              </span>
            </li>
          ) : item.m.channel === "system" ? (
            <li key={`m-${item.m.id}`} className="inline-flex max-w-full items-center gap-2 self-center rounded-full bg-success-tint px-3 py-1.5 text-[12.5px] font-semibold text-success-text">
              <Check className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
              <span>
                {item.m.body} · <time dateTime={item.at.toISOString()}>{formatDateTime(item.at)}</time>
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
  const note = m.channel === "note";
  const time = <time dateTime={new Date(m.created_at).toISOString()}>{formatDateTime(m.created_at)}</time>;
  return (
    <li className={cn("flex max-w-[64%] flex-col gap-1.5 max-md:max-w-[90%]", inbound ? "self-start" : "items-end self-end")}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span
          className={cn(
            "inline-flex size-4 items-center justify-center rounded-[4px]",
            m.channel === "whatsapp" ? "bg-success-tint text-success-text" : note ? "bg-warning-pill text-warning-text" : "bg-info-tint text-info-text",
          )}
        >
          <Icon className="size-[11px]" strokeWidth={2.2} aria-hidden />
        </span>
        {!inbound && m.sender && <span>{m.sender} ·</span>}
        <span>{CHANNEL_LABELS[m.channel]} ·</span>
        {time}
      </span>
      <div
        className={cn(
          "rounded-[14px] px-3.5 py-3 text-sm leading-normal",
          inbound ? "rounded-tl-[4px] border bg-card" : note ? "rounded-tr-[4px] border border-warning-border bg-warning-tint" : "rounded-tr-[4px] bg-accent-tint",
        )}
      >
        {m.subject && <p className="font-semibold">{m.subject}</p>}
        <p className="whitespace-pre-wrap">{m.body}</p>
      </div>
      {m.delivery_status === "failed" && (
        <span className="text-xs font-semibold text-red-700">Not delivered{m.delivery_error ? `: ${m.delivery_error}` : ""}</span>
      )}
      {m.delivery_status === "queued" && <span className="text-xs text-muted-foreground">Sending…</span>}
    </li>
  );
}
