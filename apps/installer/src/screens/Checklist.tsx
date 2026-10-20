import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import type { Nav } from "../nav";
import { useCapture, useStore } from "../store";
import { colors } from "../theme";
import type { ChecklistStep, Job } from "../types";
import { BackLink, Button, Card, Field, H1, Muted, PhotoThumb, Progress, Section } from "../ui";

const GROUPS: { label: string; products: ChecklistStep["product"][] }[] = [
  { label: "General", products: ["general"] },
  { label: "Solar and battery", products: ["solar", "battery"] },
  { label: "EV charger", products: ["ev"] },
];

export function stepsFor(steps: ChecklistStep[], job: Job, kind: "install" | "handover") {
  return steps.filter((s) => s.kind === kind && (s.product === "general" || job.products.includes(s.product))).sort((a, b) => a.position - b.position);
}

/** What still stops a step counting as complete. */
export function missing(step: ChecklistStep, c: ReturnType<typeof useCapture>) {
  const out: string[] = [];
  if (step.requiresPhoto && !c?.photoFileIds.length) out.push("a photo");
  if (step.requiresSerial && !c?.serial?.trim()) out.push("the serial number");
  for (const r of step.readings) if (!c?.readings[r.key]?.trim()) out.push(r.label);
  return out;
}

export async function takePhoto(): Promise<{ uri: string; contentType: string } | null> {
  const perm = Platform.OS === "web" ? { granted: true } : await ImagePicker.requestCameraPermissionsAsync();
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.6, exif: false };
  const res = perm.granted ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  const a = res.canceled ? null : res.assets[0];
  if (!a) return null;
  return { uri: a.uri, contentType: a.mimeType === "image/png" ? "image/png" : "image/jpeg" };
}

function SerialScanner({ onScan, onClose }: { onScan: (v: string) => void; onClose: () => void }) {
  const [perm, request] = useCameraPermissions();
  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {perm?.granted ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr", "code128", "code39", "ean13", "datamatrix"] }}
            onBarcodeScanned={(r) => {
              onScan(r.data);
              onClose();
            }}
          />
        ) : (
          <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12 }}>
            <Text style={{ color: "#fff", fontSize: 16 }}>Allow the camera to scan serial numbers.</Text>
            <Button label="Allow camera" onPress={() => void request()} />
          </View>
        )}
        <View style={{ padding: 16 }}>
          <Button label="Type it instead" variant="outline" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function StepCard({ job, step, open, onToggle }: { job: Job; step: ChecklistStep; open: boolean; onToggle: () => void }) {
  const st = useStore();
  const c = useCapture(job.id, step.id);
  const [scan, setScan] = useState(false);
  const todo = missing(step, c);
  const done = Boolean(c?.done) && todo.length === 0;
  const photos = c?.photoFileIds ?? [];
  return (
    <Card highlight={open} style={{ padding: 0 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${step.title}${done ? ", done" : ""}`} onPress={onToggle} style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 18 }} testID="checklist-step">
        <View style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: done ? colors.primary : colors.input, backgroundColor: done ? colors.primary : open ? colors.accentTint : "transparent", alignItems: "center", justifyContent: "center" }}>
          {done && <Text style={{ color: "#fff", fontWeight: "800" }}>✓</Text>}
        </View>
        <Text style={{ flex: 1, fontSize: 17, fontWeight: "600", color: done || open ? colors.ink : colors.ink2 }}>{step.title}</Text>
        {photos.length > 0 && <Muted>{`${photos.length} photo${photos.length === 1 ? "" : "s"}`}</Muted>}
      </Pressable>
      {open && (
        <View style={{ paddingHorizontal: 18, paddingBottom: 18, gap: 12 }}>
          {step.help && <Muted>{step.help}</Muted>}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {photos.map((p) => (
              <PhotoThumb key={p} id={p} contentType={st.local.photos[p]?.contentType ?? "image/jpeg"} size={100} />
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add photo for ${step.title}`}
              onPress={async () => {
                const shot = await takePhoto();
                if (!shot) return;
                const id = await st.addPhoto(job.id, shot, shot.contentType, null);
                st.capture(job.id, step.id, { photoFileIds: [...(c?.photoFileIds ?? []), id] });
              }}
              style={{ width: 100, height: 100, borderRadius: 12, borderWidth: 2, borderStyle: "dashed", borderColor: colors.primary, backgroundColor: "#f1faf6", alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ fontSize: 20, color: colors.accentStrong }}>📷</Text>
              <Text style={{ color: colors.accentStrong, fontWeight: "600" }}>Add photo</Text>
            </Pressable>
          </View>
          {step.requiresSerial && (
            <View>
              <Field label="Serial number" value={c?.serial ?? ""} onChangeText={(v) => st.capture(job.id, step.id, { serial: v })} autoCapitalize="characters" />
              {Platform.OS !== "web" && <Button label="▥ Scan serial number" variant="outline" onPress={() => setScan(true)} />}
            </View>
          )}
          {step.readings.map((r) => (
            <Field key={r.key} label={`${r.label}${r.unit ? ` (${r.unit})` : ""}`} value={c?.readings[r.key] ?? ""} keyboardType="decimal-pad" onChangeText={(v) => st.capture(job.id, step.id, { readings: { ...(c?.readings ?? {}), [r.key]: v } })} />
          ))}
          <Field label="Note (optional)" value={c?.note ?? ""} onChangeText={(v) => st.capture(job.id, step.id, { note: v || null })} multiline />
          {todo.length > 0 && <Muted style={{ color: colors.warningText }}>Still needs {todo.join(", ")}.</Muted>}
          <Button
            label={c?.done ? "Mark not done" : "Mark step done"}
            variant={c?.done ? "outline" : "primary"}
            disabled={!c?.done && todo.length > 0}
            onPress={() => {
              st.capture(job.id, step.id, { done: !c?.done });
              if (!c?.done) onToggle();
            }}
          />
        </View>
      )}
      {scan && <SerialScanner onScan={(v) => st.capture(job.id, step.id, { serial: v })} onClose={() => setScan(false)} />}
    </Card>
  );
}

export function Checklist({ nav, id }: { nav: Nav; id: string }) {
  const st = useStore();
  const job = st.bundle?.jobs.find((j) => j.id === id);
  const steps = job ? stepsFor(st.bundle!.checklist, job, "install") : [];
  const captures = useStore().local.checklist[id] ?? {};
  const doneCount = steps.filter((s) => {
    const c = captures[s.id] ?? job?.captured.find((x) => x.templateId === s.id);
    return c?.done && missing(s, c).length === 0;
  }).length;
  const [open, setOpen] = useState<string | null>(null);
  if (!job) return <Muted style={{ padding: 20 }}>This job is no longer assigned to you.</Muted>;
  return (
    <View style={{ flex: 1 }}>
      <View style={{ backgroundColor: colors.card, paddingHorizontal: 20, paddingTop: 40, paddingBottom: 16, borderBottomWidth: 1, borderColor: colors.border }}>
        <BackLink label="Job" onPress={nav.back} />
        <H1>Install checklist</H1>
        <Progress done={doneCount} total={steps.length} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        {GROUPS.map((g) => {
          const mine = steps.filter((s) => g.products.includes(s.product));
          if (!mine.length) return null;
          return (
            <View key={g.label}>
              <Section>{g.label}</Section>
              {mine.map((s) => (
                <StepCard key={s.id} job={job} step={s} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} />
              ))}
            </View>
          );
        })}
        {steps.length === 0 && <Muted>No checklist steps set up for these products. Ask the office to add them in Settings › Install checklists.</Muted>}
      </ScrollView>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: colors.card, borderTopWidth: 1, borderColor: colors.border }}>
        <Button label="Commission and hand over" onPress={() => nav.push({ name: "signoff", id })} testID="to-signoff" />
        {doneCount < steps.length && <Muted style={{ textAlign: "center", marginTop: 8, fontSize: 13 }}>{steps.length - doneCount} step(s) not finished yet</Muted>}
      </View>
    </View>
  );
}
