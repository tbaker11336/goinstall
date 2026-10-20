import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });

export function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return gbp.format(Number(value));
}

export function formatDate(d: Date | string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...opts }).format(new Date(d));
}

export function formatDateTime(d: Date | string) {
  return formatDate(d, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatMonth(d: Date | string | null | undefined) {
  return formatDate(d, { month: "long", year: "numeric" });
}

/** "3 days ago", "just now". */
export function timeAgo(d: Date | string): string {
  const seconds = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return rtf.format(-Math.round(seconds / size), unit);
  }
  return "just now";
}

export function addressLine(...parts: (string | null | undefined)[]): string {
  return parts.filter((p) => p && p.trim()).join(", ");
}
