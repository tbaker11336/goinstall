import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, PanResponder, Pressable, StyleSheet, Text, TextInput, View, type PressableProps, type TextInputProps, type ViewStyle } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { blobUri } from "./blobs";
import { useStore } from "./store";
import { colors, radius } from "./theme";

export function Button({ label, onPress, variant = "primary", disabled, busy, style, testID }: { label: string; onPress: () => void; variant?: "primary" | "outline" | "ghost"; disabled?: boolean; busy?: boolean; style?: ViewStyle; testID?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || busy) }}
      disabled={disabled || busy}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [s.btn, variant === "primary" ? s.btnPrimary : variant === "outline" ? s.btnOutline : s.btnGhost, (disabled || busy) && { opacity: 0.5 }, pressed && { opacity: 0.85 }, style]}
    >
      {busy ? <ActivityIndicator color={variant === "primary" ? colors.primaryText : colors.primary} /> : <Text style={[s.btnText, variant !== "primary" && { color: variant === "outline" ? colors.ink : colors.primary }]}>{label}</Text>}
    </Pressable>
  );
}

export function Card({ children, style, highlight }: { children: React.ReactNode; style?: ViewStyle; highlight?: boolean }) {
  return <View style={[s.card, highlight && { borderColor: colors.primary, borderWidth: 2 }, style]}>{children}</View>;
}

export function H1({ children }: { children: React.ReactNode }) {
  return (
    <Text accessibilityRole="header" style={s.h1}>
      {children}
    </Text>
  );
}

export function H2({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
      <Text accessibilityRole="header" style={s.h2}>
        {children}
      </Text>
      {right}
    </View>
  );
}

export function Muted({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[{ color: colors.ink3, fontSize: 15 }, style]}>{children}</Text>;
}

export function Section({ children }: { children: React.ReactNode }) {
  return <Text style={s.section}>{String(children).toUpperCase()}</Text>;
}

export function Checkbox({ checked, label, onChange, testID }: { checked: boolean; label: string; onChange: (v: boolean) => void; testID?: string }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label} onPress={() => onChange(!checked)} style={s.checkRow} testID={testID}>
      <View style={[s.box, checked && { backgroundColor: colors.primary, borderColor: colors.primary }]}>{checked && <Text style={{ color: "#fff", fontWeight: "700" }}>✓</Text>}</View>
      <Text style={{ fontSize: 16, color: colors.ink, flex: 1 }}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, hint, hintTone, ...props }: TextInputProps & { label: string; hint?: string; hintTone?: "info" | "muted" }) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label} nativeID={`${label}-label`}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        {...props}
        onFocus={(e) => {
          setFocus(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          props.onBlur?.(e);
        }}
        style={[s.input, focus && { borderColor: colors.primary }, props.multiline && { minHeight: 90, textAlignVertical: "top" }]}
      />
      {hint && <Text style={{ marginTop: 6, color: hintTone === "info" ? colors.info : colors.muted, fontSize: 14 }}>{hint}</Text>}
    </View>
  );
}

export function Progress({ done, total }: { done: number; total: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14 }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: done }}>
      <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden" }}>
        <View style={{ width: `${total ? (done / total) * 100 : 0}%`, height: 8, backgroundColor: colors.primary }} />
      </View>
      <Text style={{ fontWeight: "600", color: colors.ink2 }}>
        {done} of {total}
      </Text>
    </View>
  );
}

export function SyncBadge() {
  const st = useStore();
  const pending = st.outbox.length + st.files.length;
  const map = {
    synced: { text: "All synced", bg: colors.successTint, fg: colors.successText, dot: colors.success },
    syncing: { text: "Syncing…", bg: colors.accentTint, fg: colors.accentStrong, dot: colors.primary },
    pending: { text: `${pending} to sync`, bg: colors.warningTint, fg: colors.warningText, dot: colors.warning },
    offline: { text: pending ? `Offline · ${pending} saved` : "Offline", bg: "#f2f4f7", fg: colors.ink2, dot: colors.muted },
    error: { text: "Sync problem", bg: "#fef3f2", fg: "#b42318", dot: colors.danger },
  }[st.status];
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Sync status: ${map.text}. Tap to sync now.`} onPress={() => void st.sync()} style={[s.pill, { backgroundColor: map.bg }]} testID="sync-badge">
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: map.dot }} />
      <Text style={{ color: map.fg, fontWeight: "600" }}>{map.text}</Text>
    </Pressable>
  );
}

export function Tag({ label }: { label: string }) {
  return (
    <View style={{ backgroundColor: "#f2f4f7", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ color: colors.ink2, fontWeight: "500" }}>{label}</Text>
    </View>
  );
}

export function BackLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`Back to ${label}`} onPress={onPress} style={{ paddingVertical: 6, marginBottom: 6 }}>
      <Text style={{ color: colors.primary, fontWeight: "600", fontSize: 16 }}>‹ {label}</Text>
    </Pressable>
  );
}

export function PhotoThumb({ id, contentType, size = 96 }: { id: string; contentType: string; size?: number }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    void blobUri(id, contentType).then(setUri);
  }, [id, contentType]);
  if (!uri) return <View style={{ width: size, height: size, borderRadius: 12, backgroundColor: "#e4e7ec" }} accessibilityLabel="Photo (uploaded)" />;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Image } = require("react-native") as typeof import("react-native");
  return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: 12 }} accessibilityLabel="Photo" />;
}

/** Finger or mouse signature as stroke paths, scaled to a 600×200 box (the server draws the SVG). */
export function SignaturePad({ onChange, clearKey }: { onChange: (paths: string[]) => void; clearKey: number }) {
  const [paths, setPaths] = useState<string[]>([]);
  const cur = useRef<string>("");
  const size = useRef({ w: 600, h: 200 });
  const pt = (x: number, y: number) => {
    const px = Math.min(600, Math.max(0, (x / size.current.w) * 600));
    const py = Math.min(200, Math.max(0, (y / size.current.h) * 200));
    return `${px.toFixed(1)},${py.toFixed(1)}`;
  };
  useEffect(() => {
    setPaths([]);
    onChange([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearKey]);
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        cur.current = `M${pt(e.nativeEvent.locationX, e.nativeEvent.locationY)}`;
        setPaths((p) => [...p, cur.current]);
      },
      onPanResponderMove: (e) => {
        cur.current += ` L${pt(e.nativeEvent.locationX, e.nativeEvent.locationY)}`;
        setPaths((p) => [...p.slice(0, -1), cur.current]);
      },
      onPanResponderRelease: () => setPaths((p) => (onChange(p), p)),
    }),
  ).current;
  return (
    <View
      {...responder.panHandlers}
      onLayout={(e) => (size.current = { w: e.nativeEvent.layout.width || 600, h: e.nativeEvent.layout.height || 200 })}
      style={s.sigPad} accessibilityLabel="Signature area: the customer signs here with a finger" testID="signature-pad">
      <Svg width="100%" height="100%" viewBox="0 0 600 200" preserveAspectRatio="none" pointerEvents="none">
        <Rect x={48} y={160} width={504} height={1} fill={colors.input} />
        {paths.map((d, i) => (
          <Path key={i} d={d} stroke={colors.ink} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </Svg>
    </View>
  );
}

/** Roof sketch with the designed panel count (the layout itself is on the console Design tab). */
export function RoofSketch({ panels, evRun }: { panels: number; evRun: boolean }) {
  const n = Math.min(panels, 24);
  const perRow = Math.min(Math.max(Math.ceil(n / 2), 1), 12);
  const rows = Math.ceil(n / perRow);
  const w = 22;
  const h = 26;
  const startX = 165 - (perRow * (w + 2)) / 2;
  const startY = 128 - rows * (h + 2);
  return (
    <View style={{ aspectRatio: 330 / 165, borderRadius: 12, overflow: "hidden" }} accessibilityLabel={`Roof sketch with ${panels} panels`}>
      <Svg viewBox="0 0 330 165" width="100%" height="100%">
        <Rect width="330" height="165" fill="#dde5d3" />
        <Path d="M50 18 H280 V132 H50 Z" fill="#b8a898" />
        <Path d="M50 18 L105 78 H225 L280 18 Z M50 132 L105 78 H225 L280 132 Z" fill="#c8b8a8" />
        {Array.from({ length: n }, (_, i) => (
          <Rect key={i} x={startX + (i % perRow) * (w + 2)} y={startY + Math.floor(i / perRow) * (h + 2)} width={w} height={h} fill="#1e2a3e" />
        ))}
        {evRun && <Path d="M80 132 V146 H250" stroke={colors.warning} strokeWidth={3} fill="none" />}
      </Svg>
    </View>
  );
}

export const s = StyleSheet.create({
  btn: { minHeight: 52, borderRadius: radius.control + 4, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  btnPrimary: { backgroundColor: colors.primary },
  btnOutline: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.input },
  btnGhost: { backgroundColor: "transparent" },
  btnText: { color: colors.primaryText, fontSize: 17, fontWeight: "700" },
  card: { backgroundColor: colors.card, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, padding: 18, marginBottom: 14 },
  h1: { fontSize: 30, fontWeight: "800", color: colors.ink, letterSpacing: -0.5 },
  h2: { fontSize: 18, fontWeight: "700", color: colors.ink },
  section: { fontSize: 13, fontWeight: "700", letterSpacing: 0.8, color: colors.ink3, marginTop: 8, marginBottom: 10 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 10, minHeight: 48 },
  box: { width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: colors.input, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 15, fontWeight: "600", color: colors.ink2, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: colors.input, borderRadius: radius.control + 2, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17, color: colors.ink, backgroundColor: colors.card },
  pill: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  sigPad: { height: 170, borderWidth: 1, borderColor: colors.input, borderRadius: 14, backgroundColor: colors.surface, overflow: "hidden" },
});
