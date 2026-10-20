import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { Nav } from "../nav";
import { useStore } from "../store";
import { colors } from "../theme";
import { BackLink, Button, Card, Checkbox, Field, H1, H2, Muted, SignaturePad } from "../ui";
import { stepsFor } from "./Checklist";

export function SignOff({ nav, id }: { nav: Nav; id: string }) {
  const st = useStore();
  const job = st.bundle?.jobs.find((j) => j.id === id);
  const [paths, setPaths] = useState<string[]>([]);
  const [clearKey, setClearKey] = useState(0);
  const [name, setName] = useState(job?.customer?.name ?? "");
  if (!job) return <Muted style={{ padding: 20 }}>This job is no longer assigned to you.</Muted>;
  const handover = stepsFor(st.bundle!.checklist, job, "handover");
  const checked = (stepId: string) => Boolean(st.local.checklist[id]?.[stepId]?.done ?? job.captured.find((c) => c.templateId === stepId)?.done);
  const completed = st.local.status[id] === "completed" || Boolean(job.completedAt);
  const allTicked = handover.every((h) => checked(h.id));
  return (
    <View style={{ flex: 1 }}>
      <View style={{ backgroundColor: colors.card, paddingHorizontal: 20, paddingTop: 40, paddingBottom: 16, borderBottomWidth: 1, borderColor: colors.border }}>
        <BackLink label="Checklist" onPress={nav.back} />
        <H1>Customer sign-off</H1>
        <Muted style={{ marginTop: 6 }}>{[job.address.split(",")[0], job.customer?.name].filter(Boolean).join(" · ")}</Muted>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130 }}>
        <Card>
          <H2>Handover</H2>
          {handover.map((h) => (
            <Checkbox key={h.id} checked={checked(h.id)} label={h.title} onChange={(v) => st.capture(id, h.id, { done: v })} />
          ))}
          {handover.length === 0 && <Muted>No handover steps set up.</Muted>}
        </Card>
        <Card>
          <H2 right={<Button label="Clear" variant="ghost" onPress={() => setClearKey((k) => k + 1)} style={{ minHeight: 32 }} />}>Customer signature</H2>
          <SignaturePad clearKey={clearKey} onChange={setPaths} />
          <View style={{ height: 14 }} />
          <Field label="Printed name" value={name} onChangeText={setName} autoComplete="name" />
        </Card>
        <Card>
          <H2>When you complete the job</H2>
          <Muted>The photos, readings and signature sync to the office. If you have no signal they&apos;re saved on this phone and sent when you do.</Muted>
        </Card>
        {completed && (
          <Text accessibilityRole="alert" style={{ color: colors.successText, fontWeight: "700", fontSize: 16, textAlign: "center" }}>
            ✓ Job completed{st.outbox.length + st.files.length ? " · waiting for signal to sync" : " and synced"}
          </Text>
        )}
      </ScrollView>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: colors.card, borderTopWidth: 1, borderColor: colors.border }}>
        <Button
          label={completed ? "Back to my jobs" : "Complete job"}
          disabled={!completed && (name.trim().length < 2 || paths.length === 0)}
          onPress={async () => {
            if (!completed) await st.signOff(id, name.trim(), paths);
            nav.tab({ name: "jobs" });
          }}
          testID="complete-job"
        />
        {!completed && !allTicked && <Muted style={{ textAlign: "center", marginTop: 8, fontSize: 13 }}>Some handover items aren&apos;t ticked</Muted>}
      </View>
    </View>
  );
}
