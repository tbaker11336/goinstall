import { describe, expect, it } from "vitest";
import { channelsFor, daysBetween, installReminderDue, normaliseSettings, notificationText, proposalRemindersDue, smsSegments, smsUsage, surveyReminderDue, ukMobileE164 } from "./notifications";

describe("settings", () => {
  it("fills defaults, keeps allowed choices, and leaves reminders off", () => {
    const s = normaliseSettings({ events: { new_enquiry: ["sms", "fax"], survey_reminder: ["in_app", "sms"] } });
    expect(s.events.new_enquiry).toEqual(["sms"]);
    expect(s.events.survey_reminder).toEqual(["sms"]); // in_app isn't a customer channel
    expect(s.events.proposal_accepted).toEqual(["in_app", "email"]);
    expect(s.reminders).toEqual({ surveyDays: null, proposalDays: [], installDaysBefore: null });
  });
  it("cleans reminder timings", () => {
    expect(normaliseSettings({ reminders: { surveyDays: 3, proposalDays: [7, 3, 3, 0, -1, 99, 14, 21], installDaysBefore: 1 } }).reminders).toEqual({ surveyDays: 3, proposalDays: [3, 7, 14], installDaysBefore: 1 });
  });
  it("drops SMS without the add-on", () => {
    const s = normaliseSettings({ events: { new_enquiry: ["in_app", "sms"] } });
    expect(channelsFor(s, "new_enquiry", { smsActive: false })).toEqual(["in_app"]);
    expect(channelsFor(s, "new_enquiry", { smsActive: true })).toEqual(["in_app", "sms"]);
    expect(channelsFor(s, "nope", { smsActive: true })).toEqual([]);
  });
});

describe("reminder timing (UK days)", () => {
  const sent = new Date("2026-10-20T22:30:00Z"); // 23:30 on 20 Oct in London
  it("counts calendar days in UK time", () => {
    expect(daysBetween(sent, new Date("2026-10-21T00:10:00Z"))).toBe(1);
    expect(daysBetween(new Date("2026-10-25T00:30:00Z"), new Date("2026-10-26T00:30:00Z"))).toBe(1); // clocks go back
  });
  it("survey reminder once the days have passed", () => {
    expect(surveyReminderDue(sent, new Date("2026-10-22T09:00:00Z"), 3)).toBe(false);
    expect(surveyReminderDue(sent, new Date("2026-10-23T09:00:00Z"), 3)).toBe(true);
    expect(surveyReminderDue(sent, new Date("2026-10-30T09:00:00Z"), null)).toBe(false);
  });
  it("proposal reminders step by step, catching up with the latest only", () => {
    expect(proposalRemindersDue(sent, new Date("2026-10-23T09:00:00Z"), [3, 7], [])).toBe(0);
    expect(proposalRemindersDue(sent, new Date("2026-10-24T09:00:00Z"), [3, 7], [0])).toBeNull();
    expect(proposalRemindersDue(sent, new Date("2026-10-28T09:00:00Z"), [3, 7], [])).toBe(1);
    expect(proposalRemindersDue(sent, new Date("2026-10-28T09:00:00Z"), [3, 7], [1])).toBeNull();
  });
  it("install reminder on the day before", () => {
    const start = new Date("2026-11-03T08:00:00Z");
    expect(installReminderDue(start, new Date("2026-11-02T08:00:00Z"), 1)).toBe(true);
    expect(installReminderDue(start, new Date("2026-11-01T08:00:00Z"), 1)).toBe(false);
  });
});

describe("SMS", () => {
  it("counts message parts", () => {
    expect(smsSegments("a".repeat(160))).toBe(1);
    expect(smsSegments("a".repeat(161))).toBe(2);
    expect(smsSegments("a".repeat(306))).toBe(2);
    expect(smsSegments("€".repeat(80))).toBe(1); // extended: 2 each
    expect(smsSegments("€".repeat(81))).toBe(2);
    expect(smsSegments("Thanks 👍")).toBe(1);
    expect(smsSegments("👍".repeat(36))).toBe(2); // 72 code units
  });
  it("recognises UK mobiles", () => {
    expect(ukMobileE164("07700 900123")).toBe("+447700900123");
    expect(ukMobileE164("+44 7700 900123")).toBe("+447700900123");
    expect(ukMobileE164("0117 496 0000")).toBeNull();
    expect(ukMobileE164(null)).toBeNull();
  });
  it("works out extra texts against the allowance", () => {
    expect(smsUsage({ monthlyPence: 1500, includedTexts: 200, extraTextPence: 6 }, 230)).toEqual({ used: 230, included: 200, extra: 30, extraPence: 180 });
    expect(smsUsage({ monthlyPence: 1500, includedTexts: 200, extraTextPence: 6 }, 120).extra).toBe(0);
  });
  it("keeps customer texts short", () => {
    const t = notificationText("survey_reminder", { companyName: "Brightside Solar", customerFirstName: "Grace", link: "https://x.test/s/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG" });
    expect(smsSegments(t.sms)).toBeLessThanOrEqual(2);
  });
});

describe("job answers", () => {
  it("tells the office who declined, why, and what to do", () => {
    const t = notificationText("job_declined", { companyName: "Brightside Solar", installer: "Dan Hughes", detail: "EV charger installation", site: "27 Henleaze Gardens", when: "Tue 3 Nov", reason: "On holiday that week" });
    expect(t.title).toBe("Job declined at 27 Henleaze Gardens");
    expect(t.body).toBe("Dan Hughes can't do the EV charger installation at 27 Henleaze Gardens on Tue 3 Nov. Reason: On holiday that week. Rebook it on the Schedule.");
    expect(notificationText("job_accepted", { companyName: "Brightside Solar", installer: "Dan Hughes", detail: "Solar installation" }).body).toBe("Dan Hughes accepted the solar installation.");
  });
});
