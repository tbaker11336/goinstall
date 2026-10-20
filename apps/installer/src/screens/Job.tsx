import { useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { jobDates, timeOf, TYPE_LABEL, ukDate } from "../format";
import type { Nav } from "../nav";
import { useStore } from "../store";
import { colors } from "../theme";
import { BackLink, Button, Card, Checkbox, H1, H2, Muted, RoofSketch } from "../ui";

function Action({ label, icon, onPress, active, disabled }: { label: string; icon: string; onPress: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{ flex: 1, alignItems: "center", gap: 6, paddingVertical: 14, borderRadius: 16, borderWidth: 1, borderColor: active ? "#b6e2d3" : colors.border, backgroundColor: active ? colors.accentTint : colors.card, opacity: disabled ? 0.5 : 1 }}
    >
      <Text style={{ fontSize: 20, color: colors.primary }}>{icon}</Text>
      <Text style={{ fontWeight: "600", color: active ? colors.accentStrong : colors.ink }}>{label}</Text>
    </Pressable>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 12, borderTopWidth: 1, borderColor: colors.border, gap: 12 }}>
      <Muted>{label}</Muted>
      <Text style={{ fontWeight: "600", fontSize: 15, flexShrink: 1, textAlign: "right" }}>{value}</Text>
    </View>
  );
}

export function JobScreen({ nav, id }: { nav: Nav; id: string }) {
  const st = useStore();
  const job = st.bundle?.jobs.find((j) => j.id === id);
  const [omw, setOmw] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);
  if (!job) return <Muted style={{ padding: 20 }}>This job is no longer assigned to you.</Muted>;
  const dates = jobDates(job);
  const today = ukDate(new Date());
  const status = st.local.status[job.id] ?? (job.completedAt ? "completed" : job.startedAt ? "in_progress" : null);
  const solar = job.design.solar;
  const ev = job.design.ev;
  const mapsUrl = Platform.select({
    ios: `http://maps.apple.com/?daddr=${encodeURIComponent(job.address)}`,
    default: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.lat && job.lng ? `${job.lat},${job.lng}` : job.address)}`,
  });

  const primary = () => {
    if (job.type === "survey") return nav.push({ name: "survey", id: job.id });
    if (job.type === "install") {
      if (!status) st.setStatus(job.id, "in_progress");
      return nav.push({ name: "checklist", id: job.id });
    }
    st.setStatus(job.id, "completed");
  };
  const primaryLabel =
    job.type === "survey" ? (status === "completed" ? "View survey" : "Start survey") : job.type === "install" ? (status ? (status === "completed" ? "View checklist" : "Continue install") : "Start install") : status === "completed" ? "Done" : "Mark as done";

  return (
    <View style={{ flex: 1 }}>
      <View style={{ backgroundColor: colors.card, paddingHorizontal: 20, paddingTop: 40, paddingBottom: 16, borderBottomWidth: 1, borderColor: colors.border }}>
        <BackLink label="My jobs" onPress={nav.back} />
        <H1>{job.address || job.title || TYPE_LABEL[job.type]}</H1>
        <Muted style={{ marginTop: 6 }}>
          {[job.customer?.name, `${TYPE_LABEL[job.type]}${dates.length > 1 ? ` day ${Math.max(1, dates.indexOf(today) + 1)} of ${dates.length}` : ""}`, job.allDay ? null : timeOf(job.startsAt)].filter(Boolean).join(" · ")}
        </Muted>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
          <Action label="Navigate" icon="➤" onPress={() => void Linking.openURL(mapsUrl!)} disabled={!job.address} />
          <Action label="Call" icon="✆" onPress={() => void Linking.openURL(`tel:${job.customer?.phone ?? ""}`)} disabled={!job.customer?.phone} />
          <Action label={omw ? "Sent" : "On my way"} icon="◷" active onPress={() => setOmw(true)} disabled={!job.customer} />
        </View>
        {omw && (
          <Card>
            <H2>Tell {job.customer?.name.split(" ")[0]} you&apos;re on the way</H2>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[10, 20, 30, 45].map((m) => (
                <Button
                  key={m}
                  label={`${m} min`}
                  variant="outline"
                  style={{ flex: 1 }}
                  onPress={() => {
                    st.onMyWay(job.id, m);
                    setOmw(false);
                  }}
                />
              ))}
            </View>
            <Muted style={{ marginTop: 8, fontSize: 13 }}>Sent by email when you have signal.</Muted>
          </Card>
        )}

        {(solar || ev) && (
          <Card>
            <H2>Design</H2>
            {solar && solar.panelCount > 0 && <RoofSketch panels={solar.panelCount} evRun={Boolean(ev)} />}
            <View style={{ marginTop: 12 }}>
              {solar && solar.panelCount > 0 && <Row label="Solar" value={`${solar.panelCount} panels · ${solar.kWp.toFixed(2)} kWp`} />}
              {solar && solar.batteryCount > 0 && <Row label="Battery" value={`${solar.batteryCount} × battery`} />}
              {solar?.connectionForm && <Row label="DNO" value={solar.connectionForm} />}
              {ev && <Row label="EV charger" value={[ev.routeLengthM ? `${ev.routeLengthM} m run` : null, ev.cableSizeMm2 ? `${ev.cableSizeMm2} mm² cable` : null].filter(Boolean).join(" · ") || "See design"} />}
            </View>
          </Card>
        )}

        {job.notes && (
          <Card>
            <H2>Notes from the office</H2>
            <Text style={{ fontSize: 16 }}>{job.notes}</Text>
          </Card>
        )}

        {job.kit.length > 0 && (
          <Card>
            <H2>Kit check</H2>
            {job.kit.map((k) => (
              <View key={k.id}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Checkbox checked={Boolean(st.local.kitChecked[k.id])} label={`${k.quantity > 1 ? `${k.quantity} × ` : ""}${k.description}`} onChange={(v) => st.setKitChecked(k.id, v)} />
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Report a problem with ${k.description}`} onPress={() => setReporting(reporting === k.id ? null : k.id)} style={{ padding: 8 }}>
                    <Text style={{ color: k.issue ? colors.warningText : colors.primary, fontWeight: "600" }}>{k.issue ? `Reported ${k.issue}` : "Report"}</Text>
                  </Pressable>
                </View>
                {reporting === k.id && (
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                    {(["missing", "damaged"] as const).map((issue) => (
                      <Button
                        key={issue}
                        label={issue === "missing" ? "Missing" : "Damaged"}
                        variant="outline"
                        style={{ flex: 1 }}
                        onPress={() => {
                          st.reportKit(k.id, issue, null);
                          setReporting(null);
                        }}
                      />
                    ))}
                  </View>
                )}
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: colors.card, borderTopWidth: 1, borderColor: colors.border }}>
        <Button label={primaryLabel} onPress={primary} disabled={job.type !== "install" && job.type !== "survey" && status === "completed"} testID="job-primary" />
      </View>
    </View>
  );
}
