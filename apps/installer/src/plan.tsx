import { Text, View } from "react-native";
import Svg, { Circle, G, Polygon, Polyline, Rect, Text as SvgText } from "react-native-svg";
import { colors } from "./theme";
import type { Job, PlanGeometry, Point } from "./types";

/** Same colours as the console's string plan. */
const STRING_COLOURS = ["#2a78d6", "#eb6834", "#12a150", "#a855f7", "#e5b100", "#0ea5b7", "#d6336c", "#8b5e34"];
const stringColour = (n: number) => STRING_COLOURS[(n - 1) % STRING_COLOURS.length]!;
const pts = (p: Point[]) => p.map((q) => `${q.x},${q.y}`).join(" ");

/** The roof layout from above: each face, its panels coloured by string, and obstructions. North is up. */
export function RoofPlan({ plan }: { plan: PlanGeometry }) {
  const pad = 1.5;
  const { minX, minY, maxX, maxY } = plan.bounds;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  const panels = plan.roofs.reduce((n, r) => n + r.panels.length, 0);
  const strings = [...new Set(plan.roofs.flatMap((r) => r.panels.map((p) => p.string).filter((s): s is number => s !== null)))].sort((a, b) => a - b);
  const k = Math.max(w, h) / 30; // label size scales with the drawing
  return (
    <View>
      <View
        style={{ aspectRatio: Math.max(1, Math.min(2, w / h)), borderRadius: 12, overflow: "hidden", backgroundColor: "#dde5d3" }}
        accessible
        accessibilityLabel={`Roof layout: ${plan.roofs.filter((r) => r.panels.length).map((r) => `${r.label.split(" · ")[0]}, ${r.panels.length} panels`).join("; ")}`}
      >
        <Svg viewBox={`${minX - pad} ${minY - pad} ${w} ${h}`} width="100%" height="100%">
          {plan.roofs.map((r, i) => (
            <G key={i}>
              <Polygon points={pts(r.outline)} fill={r.used ? "#b9a898" : "#cfc3b6"} stroke="#8b7b6c" strokeWidth={0.06} />
              {r.obstructions.map((o, j) => (
                <Polygon key={j} points={pts(o)} fill="#8b7b6c" stroke="#DC6803" strokeWidth={0.05} />
              ))}
              {r.panels.map((p, j) => (
                <Polygon key={j} points={pts(p.corners)} fill="#1f2a44" stroke={p.string ? stringColour(p.string) : "#5b6b8c"} strokeWidth={p.string ? 0.09 : 0.03} />
              ))}
              {r.panels.length === 0 && (
                <SvgText x={r.centre.x} y={r.centre.y} fontSize={0.9 * k} fontWeight="700" fill="#5b4b3c" textAnchor="middle">
                  {r.label.split(" · ")[0]?.replace("Roof ", "")}
                </SvgText>
              )}
            </G>
          ))}
          {/* North arrow */}
          <G x={maxX + pad * 0.4} y={minY - pad * 0.3}>
            <Polygon points={`0,${-0.9 * k} ${0.4 * k},${0.3 * k} 0,0 ${-0.4 * k},${0.3 * k}`} fill={colors.ink} />
          </G>
        </Svg>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
        <Text style={{ color: colors.ink3, fontSize: 13 }}>{panels} panels · north up</Text>
        {strings.map((s) => (
          <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: stringColour(s) }} />
            <Text style={{ color: colors.ink3, fontSize: 13 }}>String {s}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** The EV plan: supply, charger and the cable route between them, in metres. */
export function EvPlan({ ev }: { ev: NonNullable<Job["design"]["ev"]> }) {
  const all = [...(ev.route ?? []), ...(ev.supply ? [ev.supply] : []), ...(ev.charger ? [ev.charger] : [])];
  if (!all.length) return null;
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const pad = 3;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const w = Math.max(Math.max(...xs) - Math.min(...xs) + pad * 2, 8);
  const h = Math.max(Math.max(...ys) - Math.min(...ys) + pad * 2, 6);
  const k = Math.max(w, h) / 30;
  return (
    <View
      style={{ aspectRatio: Math.max(1, Math.min(2, w / h)), borderRadius: 12, overflow: "hidden", backgroundColor: "#eef1ea", marginTop: 10 }}
      accessible
      accessibilityLabel={`EV cable route from ${ev.supplyLabel ?? "the supply"} to ${ev.chargerLabel ?? "the charger"}${ev.routeLengthM ? `, ${ev.routeLengthM} m` : ""}`}
    >
      <Svg viewBox={`${minX} ${minY} ${w} ${h}`} width="100%" height="100%">
        {ev.route.length > 1 && <Polyline points={pts(ev.route)} fill="none" stroke={colors.warning} strokeWidth={0.4 * k} strokeDasharray={`${1 * k} ${0.5 * k}`} strokeLinejoin="round" />}
        {ev.supply && (
          <G>
            <Rect x={ev.supply.x - 0.9 * k} y={ev.supply.y - 0.9 * k} width={1.8 * k} height={1.8 * k} rx={0.3 * k} fill="#fff" stroke={colors.ink} strokeWidth={0.2 * k} />
            <SvgText x={ev.supply.x} y={ev.supply.y - 1.4 * k} fontSize={0.9 * k} fontWeight="700" fill={colors.ink} textAnchor="middle">
              {ev.supplyLabel || "Supply"}
            </SvgText>
          </G>
        )}
        {ev.charger && (
          <G>
            <Circle cx={ev.charger.x} cy={ev.charger.y} r={1.1 * k} fill={colors.primary} stroke="#fff" strokeWidth={0.2 * k} />
            <SvgText x={ev.charger.x} y={ev.charger.y - 1.6 * k} fontSize={0.9 * k} fontWeight="700" fill={colors.accentStrong} textAnchor="middle">
              {ev.chargerLabel || "Charger"}
            </SvgText>
          </G>
        )}
      </Svg>
    </View>
  );
}
