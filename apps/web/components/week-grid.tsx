"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { moveBookingAction } from "@/lib/actions/bookings";
import { cn } from "@/lib/utils";

export interface GridRow {
  key: string;
  label: string;
  /** Dropping an install here assigns this team. */
  teamId: string | null;
}

export interface GridBooking {
  id: string;
  rowKey: string;
  /** Index of the first visible day, and how many visible days it covers. */
  start: number;
  span: number;
  title: string;
  subtitle: string;
  tone: "this" | "other" | "scaffold" | "survey";
  clash: string | null;
  href?: string;
  draggable: boolean;
}

const TONES = {
  this: "bg-primary text-primary-foreground",
  other: "bg-muted text-foreground",
  scaffold: "bg-accent-tint text-accent-strong",
  survey: "bg-info-tint text-info-text",
};

/**
 * Week calendar: one row per team (plus scaffold and surveys), one column per
 * day. Bookings can be dragged to another day or team; the booking form on
 * the page is the keyboard alternative.
 */
export function WeekGrid({ days, rows, bookings, caption }: { days: { date: string; label: string }[]; rows: GridRow[]; bookings: GridBooking[]; caption: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cols = `minmax(110px, 0.8fr) repeat(${days.length}, minmax(96px, 1fr))`;

  const drop = (e: React.DragEvent<HTMLDivElement>, row: GridRow) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/booking");
    if (!id) return;
    const area = e.currentTarget.getBoundingClientRect();
    const dayWidth = area.width / days.length;
    const offset = Number(e.dataTransfer.getData("text/offset") || 0);
    const idx = Math.max(0, Math.min(days.length - 1, Math.floor((e.clientX - area.left) / dayWidth) - offset));
    start(async () => {
      const r = await moveBookingAction(id, days[idx]!.date, row.teamId);
      setError(r.error ?? null);
      router.refresh();
    });
  };

  return (
    <div className={cn("overflow-x-auto rounded-[10px] border", pending && "opacity-70")} role="table" aria-label={caption}>
      <div className="min-w-[640px]">
        <div role="row" className="grid border-b bg-surface-subtle text-[13px] font-semibold text-ink-2" style={{ gridTemplateColumns: cols }}>
          <span role="columnheader" className="px-3.5 py-2.5">
            <span className="sr-only">Team</span>
          </span>
          {days.map((d) => (
            <span role="columnheader" key={d.date} className="border-l px-3.5 py-2.5">
              {d.label}
            </span>
          ))}
        </div>
        {rows.map((row) => {
          const items = bookings.filter((b) => b.rowKey === row.key);
          return (
            <div role="row" key={row.key} className="grid border-b last:border-b-0" style={{ gridTemplateColumns: cols }}>
              <span role="rowheader" className="flex items-center px-3.5 py-3 text-sm font-semibold">
                {row.label}
              </span>
              <div
                role="cell"
                aria-label={`${row.label} bookings`}
                className={cn("relative grid gap-1.5 p-1.5", over === row.key && "bg-accent-tint/60")}
                style={{ gridColumn: `span ${days.length}`, gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`, gridAutoFlow: "row dense", minHeight: 64 }}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes("text/booking")) {
                    e.preventDefault();
                    setOver(row.key);
                  }
                }}
                onDragLeave={() => setOver((o) => (o === row.key ? null : o))}
                onDrop={(e) => drop(e, row)}
              >
                <div aria-hidden className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
                  {days.map((d, i) => (
                    <span key={d.date} className={cn(i > 0 && "border-l")} />
                  ))}
                </div>
                {items.map((b) => {
                  const body = (
                    <>
                      <span className="block truncate font-semibold">{b.title}</span>
                      <span className="block truncate opacity-90">{b.subtitle}</span>
                      {b.clash && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-warning-text">
                          <AlertTriangle className="size-3.5" aria-hidden /> {b.clash}
                        </span>
                      )}
                    </>
                  );
                  const cls = cn("relative z-10 rounded-[8px] px-3 py-2 text-[13px] leading-snug", TONES[b.tone], b.clash && "ring-2 ring-warning", b.draggable && "cursor-grab active:cursor-grabbing");
                  return (
                    <div
                      key={b.id}
                      data-testid="grid-booking"
                      style={{ gridColumn: `${b.start + 1} / span ${b.span}` }}
                      draggable={b.draggable}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/booking", b.id);
                        // Keep the grab point: dropping where the pointer is moves the start by the same amount.
                        const r = e.currentTarget.getBoundingClientRect();
                        e.dataTransfer.setData("text/offset", String(Math.floor(((e.clientX - r.left) / r.width) * b.span)));
                      }}
                      className={cls}
                    >
                      {b.href ? (
                        <Link href={b.href} className="block focus-visible:outline-2" draggable={false}>
                          {body}
                        </Link>
                      ) : (
                        body
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="border-t bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      )}
    </div>
  );
}
