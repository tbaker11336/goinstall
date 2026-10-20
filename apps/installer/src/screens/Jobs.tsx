import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { addDays, dayLabel, jobDates, PRODUCT_LABEL, timeOf, TYPE_LABEL, ukDate, longDay } from "../format";
import type { Nav } from "../nav";
import { useStore } from "../store";
import { colors } from "../theme";
import type { Job } from "../types";
import { Card, H1, Muted, Section, SyncBadge, Tag } from "../ui";

function JobCard({ job, day, next, onPress }: { job: Job; day: string; next: boolean; onPress: () => void }) {
  const st = useStore();
  const dates = jobDates(job);
  const dayN = dates.indexOf(day) + 1;
  const done = st.local.status[job.id] === "completed" || Boolean(job.completedAt);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${TYPE_LABEL[job.type]}, ${job.address || job.title}${next ? ", next" : ""}${done ? ", completed" : ""}`} onPress={onPress} testID="job-card">
      <Card highlight={next} style={{ flexDirection: "row", gap: 16, opacity: done ? 0.6 : 1 }}>
        <View style={{ width: 64, alignItems: "center" }}>
          <Text style={{ fontSize: 18, fontWeight: "700" }}>{job.allDay ? "08:30" : timeOf(job.startsAt)}</Text>
          <Muted style={{ fontSize: 14 }}>{dates.length > 1 ? `Day ${dayN}/${dates.length}` : job.allDay ? "All day" : ""}</Muted>
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontSize: 19, fontWeight: "700", flexShrink: 1 }}>{job.type === "task" ? (job.title ?? "Task") : TYPE_LABEL[job.type]}</Text>
            {next && !done && (
              <View style={{ backgroundColor: colors.accentTint, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
                <Text style={{ color: colors.accentStrong, fontWeight: "700", fontSize: 13 }}>NEXT</Text>
              </View>
            )}
            {done && <Text style={{ color: colors.successText, fontWeight: "700" }}>✓ Done</Text>}
          </View>
          <Muted>{[job.address, job.customer?.name].filter(Boolean).join(" · ")}</Muted>
          {job.products.length > 0 && (
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              {job.products.map((p) => (
                <Tag key={p} label={PRODUCT_LABEL[p] ?? p} />
              ))}
            </View>
          )}
          {job.type === "install" && job.kit.length > 0 && (
            <Text style={{ color: job.kit.some((k) => k.issue) ? colors.warningText : colors.successText, fontWeight: "600" }}>{job.kit.some((k) => k.issue) ? "⚠ Kit issue reported" : `✓ ${job.kit.length} kit lines`}</Text>
          )}
        </View>
      </Card>
    </Pressable>
  );
}

export function Jobs({ nav }: { nav: Nav }) {
  const st = useStore();
  const today = ukDate(new Date());
  const [day, setDay] = useState(today);
  const monday = useMemo(() => addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7)), [today]);
  const week = Array.from({ length: 5 }, (_, i) => addDays(monday, i));
  const jobs = st.bundle?.jobs ?? [];
  const onDay = (d: string) => jobs.filter((j) => jobDates(j).includes(d));
  const todays = onDay(day);
  const next = todays.find((j) => !(st.local.status[j.id] === "completed" || j.completedAt));
  const tomorrow = onDay(addDays(day, 1));
  return (
    <View style={{ flex: 1 }}>
      <View style={{ backgroundColor: colors.card, paddingHorizontal: 20, paddingTop: 48, paddingBottom: 14, borderBottomWidth: 1, borderColor: colors.border }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
          <View>
            <Muted>{longDay(new Date(`${day}T12:00:00Z`))}</Muted>
            <H1>My jobs</H1>
          </View>
          <SyncBadge />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 16 }} accessibilityRole="tablist">
          {week.map((d) => {
            const sel = d === day;
            return (
              <Pressable key={d} accessibilityRole="tab" accessibilityState={{ selected: sel }} accessibilityLabel={`${dayLabel(d)} ${Number(d.slice(8))}, ${onDay(d).length} jobs`} onPress={() => setDay(d)} style={{ alignItems: "center", paddingVertical: 10, width: 60, borderRadius: 14, backgroundColor: sel ? colors.primary : "transparent" }}>
                <Text style={{ color: sel ? "#fff" : colors.ink3, fontWeight: "500" }}>{dayLabel(d)}</Text>
                <Text style={{ color: sel ? "#fff" : colors.ink, fontSize: 20, fontWeight: "700" }}>{Number(d.slice(8))}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {st.error && (
          <Text accessibilityRole="alert" style={{ color: colors.warningText, marginBottom: 10 }}>
            {st.error}
          </Text>
        )}
        <Section>{`${todays.length} job${todays.length === 1 ? "" : "s"} ${day === today ? "today" : ""}`.trim()}</Section>
        {todays.length === 0 && <Muted>Nothing booked.</Muted>}
        {todays.map((j) => (
          <JobCard key={j.id} job={j} day={day} next={j === next} onPress={() => nav.push({ name: "job", id: j.id })} />
        ))}
        {tomorrow.length > 0 && (
          <>
            <Section>{day === today ? "Tomorrow" : "Next day"}</Section>
            {tomorrow.map((j) => (
              <JobCard key={j.id} job={j} day={addDays(day, 1)} next={false} onPress={() => nav.push({ name: "job", id: j.id })} />
            ))}
          </>
        )}
        {!st.bundle && <Muted>Loading your jobs…</Muted>}
      </ScrollView>
    </View>
  );
}
