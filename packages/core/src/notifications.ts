/**
 * Notifications: what happens (events), who hears about it (internal staff or
 * the external customer) and how (in the app, by email, by SMS when the
 * company has the SMS add-on). Companies choose the channels per event and
 * the reminder timings; reminders stay off until a company sets them.
 */

export const NOTIFICATION_CHANNELS = ["in_app", "email", "sms"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const CHANNEL_LABELS: Record<NotificationChannel, string> = { in_app: "In app", email: "Email", sms: "SMS" };

export type Audience = "internal" | "external";

export interface NotificationEvent {
  key: string;
  audience: Audience;
  label: string;
  /** Who receives it. */
  to: string;
  channels: readonly NotificationChannel[];
  defaults: readonly NotificationChannel[];
}

export const NOTIFICATION_EVENTS = [
  // Internal: the team.
  { key: "new_enquiry", audience: "internal", label: "New enquiry", to: "Project owner, or admins and office if unassigned", channels: ["in_app", "email", "sms"], defaults: ["in_app", "email"] },
  { key: "survey_completed", audience: "internal", label: "Customer completed the online survey", to: "Project owner", channels: ["in_app", "email", "sms"], defaults: ["in_app"] },
  { key: "proposal_viewed", audience: "internal", label: "Customer opened the proposal", to: "Project owner", channels: ["in_app", "email", "sms"], defaults: ["in_app"] },
  { key: "proposal_accepted", audience: "internal", label: "Proposal accepted and signed", to: "Project owner", channels: ["in_app", "email", "sms"], defaults: ["in_app", "email"] },
  { key: "payment_received", audience: "internal", label: "Deposit or balance paid", to: "Project owner", channels: ["in_app", "email", "sms"], defaults: ["in_app", "email"] },
  { key: "job_assigned", audience: "internal", label: "Job booked or changed for an installer", to: "Installers on the job", channels: ["in_app", "email", "sms"], defaults: ["in_app"] },
  { key: "job_accepted", audience: "internal", label: "Installer accepted a job", to: "Project owner, or admins and office", channels: ["in_app", "email", "sms"], defaults: ["in_app"] },
  { key: "job_declined", audience: "internal", label: "Installer declined a job", to: "Project owner, or admins and office", channels: ["in_app", "email", "sms"], defaults: ["in_app", "email"] },
  { key: "kit_issue", audience: "internal", label: "Installer reported missing or damaged kit", to: "Project owner", channels: ["in_app", "email", "sms"], defaults: ["in_app", "email"] },
  { key: "job_completed", audience: "internal", label: "Install completed in the app", to: "Project owner", channels: ["in_app", "email", "sms"], defaults: ["in_app"] },
  { key: "customer_reply", audience: "internal", label: "Customer replied by text", to: "Project owner", channels: ["in_app", "email", "sms"], defaults: ["in_app"] },
  // External: the customer.
  { key: "survey_reminder", audience: "external", label: "Reminder to finish the online survey", to: "Customer", channels: ["email", "sms"], defaults: ["email"] },
  { key: "proposal_reminder", audience: "external", label: "Reminder about the proposal", to: "Customer", channels: ["email", "sms"], defaults: ["email"] },
  { key: "install_reminder", audience: "external", label: "Reminder before the install", to: "Customer", channels: ["email", "sms"], defaults: ["email"] },
  { key: "on_my_way", audience: "external", label: "Installer on the way", to: "Customer", channels: ["email", "sms"], defaults: ["email"] },
] as const satisfies readonly NotificationEvent[];

export type NotificationEventKey = (typeof NOTIFICATION_EVENTS)[number]["key"];
export const eventDef = (key: string): NotificationEvent | undefined => NOTIFICATION_EVENTS.find((e) => e.key === key);

export interface ReminderTimings {
  /** Days after sending the online survey link; null = off. */
  surveyDays: number | null;
  /** Days after sending the proposal, one reminder each; empty = off. */
  proposalDays: number[];
  /** Days before the install starts; null = off. */
  installDaysBefore: number | null;
}

export interface NotificationSettings {
  events: Partial<Record<string, NotificationChannel[]>>;
  reminders: ReminderTimings;
}

/** Reminders are off until each company sets its own timings (decision, 25 Oct 2026). */
export const DEFAULT_REMINDERS: ReminderTimings = { surveyDays: null, proposalDays: [], installDaysBefore: null };

/** Settings as stored, filled with the defaults and stripped of anything unknown. */
export function normaliseSettings(raw: unknown): NotificationSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as { events?: Record<string, unknown>; reminders?: Partial<ReminderTimings> };
  const events: NotificationSettings["events"] = {};
  for (const e of NOTIFICATION_EVENTS) {
    const chosen = r.events?.[e.key];
    events[e.key] = Array.isArray(chosen) ? (e.channels as readonly NotificationChannel[]).filter((c) => chosen.includes(c)) : [...e.defaults];
  }
  const day = (v: unknown, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null);
  const rem = r.reminders ?? {};
  return {
    events,
    reminders: {
      surveyDays: day(rem.surveyDays, 60),
      proposalDays: [...new Set((Array.isArray(rem.proposalDays) ? rem.proposalDays : []).map((d) => day(d, 90)).filter((d): d is number => d !== null && d > 0))].sort((a, b) => a - b).slice(0, 3),
      installDaysBefore: day(rem.installDaysBefore, 14),
    },
  };
}

/** The channels an event goes out on: the company's choice, less SMS without the add-on. */
export function channelsFor(settings: NotificationSettings, key: string, opts: { smsActive: boolean }): NotificationChannel[] {
  const def = eventDef(key);
  if (!def) return [];
  return (settings.events[key] ?? [...def.defaults]).filter((c) => def.channels.includes(c) && (c !== "sms" || opts.smsActive));
}

// ---------------------------------------------------------------------------
// Reminder timing (calendar days in UK time; the job runs once a day)
// ---------------------------------------------------------------------------

const ukDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
const dayNumber = (d: Date) => Math.round(Date.parse(`${ukDay(d)}T00:00:00Z`) / 86_400_000);
/** Whole UK calendar days from `from` to `to`. */
export const daysBetween = (from: Date, to: Date) => dayNumber(to) - dayNumber(from);

/** The proposal reminder steps due today (each step is sent once; missed days catch up with the latest only). */
export function proposalRemindersDue(sentAt: Date, now: Date, days: readonly number[], alreadySent: readonly number[]): number | null {
  const elapsed = daysBetween(sentAt, now);
  const last = Math.max(-1, ...alreadySent);
  // Only steps after the latest one sent: a later reminder makes earlier ones moot.
  const due = days.map((d, i) => ({ d, i })).filter(({ d, i }) => elapsed >= d && i > last);
  return due.length ? due[due.length - 1]!.i : null;
}

export const surveyReminderDue = (sentAt: Date, now: Date, days: number | null) => days !== null && daysBetween(sentAt, now) >= days;

export const installReminderDue = (startsAt: Date, now: Date, daysBefore: number | null) => daysBefore !== null && daysBetween(now, startsAt) === daysBefore;

// ---------------------------------------------------------------------------
// SMS
// ---------------------------------------------------------------------------

const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = "^{}\\[~]|€";

/** Message parts a text is billed as: 160 GSM characters (153 when split), or 70 (67) with other characters such as emoji. */
export function smsSegments(text: string): number {
  const chars = [...text];
  const gsm = chars.every((c) => GSM.includes(c) || GSM_EXT.includes(c));
  if (gsm) {
    const len = chars.reduce((n, c) => n + (GSM_EXT.includes(c) ? 2 : 1), 0);
    return len <= 160 ? 1 : Math.ceil(len / 153);
  }
  const len = text.length; // UTF-16 code units, as the network counts them
  return len <= 70 ? 1 : Math.ceil(len / 67);
}

/** A UK mobile number as +447…, or null when it isn't one. */
export function ukMobileE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/[\s()-]/g, "");
  const m = d.match(/^(?:\+44|0044|0)(7\d{9})$/);
  return m ? `+44${m[1]}` : null;
}

export interface SmsPlan {
  monthlyPence: number;
  includedTexts: number;
  extraTextPence: number;
}

/** This period's use against the allowance; extra texts are charged on the next monthly invoice. */
export function smsUsage(plan: SmsPlan, used: number): { used: number; included: number; extra: number; extraPence: number } {
  const extra = Math.max(0, used - plan.includedTexts);
  return { used, included: plan.includedTexts, extra, extraPence: extra * plan.extraTextPence };
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

export interface MessageData {
  companyName: string;
  customerFirstName?: string;
  /** Internal messages: who the project is for. */
  customerName?: string;
  site?: string;
  link?: string;
  when?: string;
  installer?: string;
  eta?: string;
  /** Why an installer declined a job. */
  reason?: string;
  detail?: string;
}

/** The words for each event: a short title (in-app and email subject), a body, and an SMS version. */
export function notificationText(key: string, d: MessageData): { title: string; body: string; sms: string } {
  const hi = d.customerFirstName ? `Hi ${d.customerFirstName}, ` : "Hi, ";
  const site = d.site ? ` at ${d.site}` : "";
  const who = d.customerName ?? "The customer";
  // "the solar installation", "the EV charger installation".
  const job = d.detail ? (/^EV\b/.test(d.detail) ? d.detail : `${d.detail[0]!.toLowerCase()}${d.detail.slice(1)}`) : "job";
  const reason = d.reason ? ` Reason: ${d.reason.trim()}${/[.!?]$/.test(d.reason.trim()) ? "" : "."}` : "";
  switch (key) {
    case "new_enquiry":
      return { title: `New enquiry${site}`, body: `A new enquiry came in${site}.${d.detail ? ` ${d.detail}` : ""}`, sms: `GoInstall: new enquiry${site}.` };
    case "survey_completed":
      return { title: `Online survey completed${site}`, body: `${who} completed the online survey${d.detail ? ` (${d.detail})` : ""}${site}.`, sms: `GoInstall: online survey completed${site}.` };
    case "proposal_viewed":
      return { title: `Proposal opened${site}`, body: `${who} opened the proposal${site}.`, sms: `GoInstall: proposal opened${site}.` };
    case "proposal_accepted":
      return { title: `Proposal accepted${site}`, body: `${d.detail ?? who} accepted and signed the proposal${site}.`, sms: `GoInstall: proposal accepted${site}.` };
    case "payment_received":
      return { title: `Payment received${site}`, body: `${d.detail ?? "A payment was received"}${site}.`, sms: `GoInstall: ${d.detail ?? "payment received"}${site}.` };
    case "job_assigned":
      return { title: `Job booked${site}`, body: `You're booked on a job${site}${d.when ? ` on ${d.when}` : ""}. Open the installer app for the details.`, sms: `${d.companyName}: you're booked on a job${site}${d.when ? ` on ${d.when}` : ""}. Details in the GoInstall app.` };
    case "kit_issue":
      return { title: `Kit problem reported${site}`, body: `${d.detail ?? "An installer reported a kit problem"}${site}.`, sms: `GoInstall: kit problem reported${site}.` };
    case "job_completed":
      return { title: `Install completed${site}`, body: `The install${site} was completed in the app.${d.detail ? ` ${d.detail}` : ""}`, sms: `GoInstall: install completed${site}.` };
    case "job_accepted":
      return { title: `Job accepted${site}`, body: `${d.installer ?? "The installer"} accepted the ${job}${site}${d.when ? ` on ${d.when}` : ""}.`, sms: `GoInstall: ${d.installer ?? "installer"} accepted the job${site}.` };
    case "job_declined":
      return {
        title: `Job declined${site}`,
        body: `${d.installer ?? "The installer"} can't do the ${job}${site}${d.when ? ` on ${d.when}` : ""}.${reason} Rebook it on the Schedule.`,
        sms: `GoInstall: ${d.installer ?? "installer"} declined the job${site}. Rebook it on the Schedule.`,
      };
    case "customer_reply":
      return { title: `Text from the customer${site}`, body: d.detail ?? "The customer replied by text.", sms: `GoInstall: customer text${site}.` };
    case "survey_reminder":
      return {
        title: `A reminder from ${d.companyName}: your survey`,
        body: `${hi}just a reminder to finish your short online survey so we can design your system${d.link ? `: ${d.link}` : "."}\n\nThank you,\n${d.companyName}`,
        sms: `${hi}a reminder from ${d.companyName} to finish your online survey${d.link ? `: ${d.link}` : "."}`,
      };
    case "proposal_reminder":
      return {
        title: `Your proposal from ${d.companyName}`,
        body: `${hi}just checking you've had a chance to look at your proposal${d.link ? `: ${d.link}` : "."} If you have any questions, reply to this email.\n\nThank you,\n${d.companyName}`,
        sms: `${hi}${d.companyName} here. Have you had a chance to look at your proposal?${d.link ? ` ${d.link}` : ""}`,
      };
    case "install_reminder":
      return {
        title: `Your install${d.when ? ` on ${d.when}` : ""}`,
        body: `${hi}a reminder that we're installing${site}${d.when ? ` on ${d.when}` : ""}. Please make sure we can get to the meter and the install areas.\n\nSee you then,\n${d.companyName}`,
        sms: `${hi}${d.companyName} here: a reminder we're installing${d.when ? ` on ${d.when}` : ""}. Please make sure we can reach the meter.`,
      };
    case "on_my_way":
      return {
        title: `${d.installer ?? "Your installer"} is on the way`,
        body: `${hi}${d.installer ?? "your installer"} from ${d.companyName} is on the way${d.eta ? ` and should be with you ${d.eta}` : ""}.\n\n${d.companyName}`,
        sms: `${hi}${d.installer ?? "your installer"} from ${d.companyName} is on the way${d.eta ? ` and should be with you ${d.eta}` : ""}.`,
      };
    default:
      return { title: key, body: d.detail ?? "", sms: d.detail ?? "" };
  }
}
