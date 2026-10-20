import "server-only";
import { CABLE_LABELS, cableLength, distance, MARKER_CODES, MARKER_LABELS, type Point } from "@goinstall/core";
import { Circle, Document, G, Image, Line, Page, Polygon, Polyline, Rect, renderToBuffer, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { CABLE_COLOURS, MARKER_COLOURS, stringColour } from "@/app/(console)/projects/[id]/design/plan-style";
import type { DesignDoc, Segment } from "./design-docs";
import { formatDate } from "./utils";

const INK = "#101828";
const INK3 = "#475467";
const LINE = "#e4e7ec";
const BLANK = "______";

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 9, color: INK, fontFamily: "Helvetica" },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: LINE, paddingBottom: 8, marginBottom: 10 },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: INK3 },
  h: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  section: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: INK3, letterSpacing: 0.6, marginTop: 10, marginBottom: 3 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: LINE },
  key: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 3 },
  small: { fontSize: 7.5, color: INK3, lineHeight: 1.35 },
  footer: { position: "absolute", bottom: 14, left: 28, right: 28, fontSize: 7, color: INK3, flexDirection: "row", justifyContent: "space-between" },
});

const cosd = (deg: number) => Math.cos((deg * Math.PI) / 180) || 1;
const segTransform = (sg: Segment) => `translate(${sg.origin.x} ${sg.origin.y}) rotate(${sg.azimuth - 180}) translate(${-sg.width / 2} ${(-sg.depth * cosd(sg.pitch)) / 2}) scale(1 ${cosd(sg.pitch)})`;
const polygonOf = (sg: Segment) => [
  { x: sg.insetLeft, y: 0 },
  { x: sg.width - sg.insetRight, y: 0 },
  { x: sg.width, y: sg.depth },
  { x: 0, y: sg.depth },
];
/** A roof-plane point in plan metres (the same transform as the designer). */
function toPlan(sg: Segment, p: Point): Point {
  const x = p.x - sg.width / 2;
  const y = p.y * cosd(sg.pitch) - (sg.depth * cosd(sg.pitch)) / 2;
  const a = ((sg.azimuth - 180) * Math.PI) / 180;
  return { x: sg.origin.x + x * Math.cos(a) - y * Math.sin(a), y: sg.origin.y + x * Math.sin(a) + y * Math.cos(a) };
}
const pts = (p: Point[]) => p.map((q) => `${q.x},${q.y}`).join(" ");
const metres = (n: number) => `${Math.round(n * 10) / 10} m`;

function Header({ d, title }: { d: DesignDoc; title: string }) {
  return (
    <View style={s.header}>
      <View>
        <Text style={s.h}>{title}</Text>
        <Text style={s.muted}>
          {d.contactName}
          {d.siteAddress ? ` · ${d.siteAddress}` : ""}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[s.bold, { color: d.brand }]}>{d.companyName}</Text>
        <Text style={s.muted}>{d.mcsNumber ? `MCS ${d.mcsNumber} · ` : ""}Design version {d.version} · {formatDate(d.savedAt, { day: "numeric", month: "long", year: "numeric" })}</Text>
      </View>
    </View>
  );
}

function Footer({ d }: { d: DesignDoc }) {
  return (
    <View style={s.footer} fixed>
      <Text>
        {d.companyName} · generated from design version {d.version}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.muted}>{label}</Text>
      <Text style={{ maxWidth: 150, textAlign: "right" }}>{value}</Text>
    </View>
  );
}

function PlanPage({ d, aerial }: { d: DesignDoc; aerial: { data: Buffer; widthM: number } | null }) {
  // Frame everything drawn, with a margin, as a square.
  const all: Point[] = [
    ...d.segments.flatMap((sg) => polygonOf(sg).map((p) => toPlan(sg, p))),
    ...d.markup.markers.map((m) => ({ x: m.x, y: m.y })),
    ...d.markup.cables.flatMap((c) => c.points),
    ...d.markup.measurements.flatMap((m) => [m.a, m.b]),
  ];
  const xs = all.length ? all.map((p) => p.x) : [-10, 10];
  const ys = all.length ? all.map((p) => p.y) : [-10, 10];
  const size = Math.max(16, Math.max(...xs) - Math.min(...xs) + 8, Math.max(...ys) - Math.min(...ys) + 8);
  const vx = (Math.min(...xs) + Math.max(...xs)) / 2 - size / 2;
  const vy = (Math.min(...ys) + Math.max(...ys)) / 2 - size / 2;
  const box = 440;
  const k = box / size;
  const px = (p: Point) => ({ left: (p.x - vx) * k, top: (p.y - vy) * k });
  const wired = d.wiredByHand;
  const labels: { at: Point; text: string; colour: string }[] = [
    ...d.markup.markers.map((m) => ({ at: { x: m.x, y: m.y + 1.3 }, text: m.note ? `${MARKER_LABELS[m.kind]}: ${m.note}` : MARKER_LABELS[m.kind], colour: MARKER_COLOURS[m.kind] })),
    ...d.markup.cables.map((c) => {
      const i = Math.floor((c.points.length - 1) / 2);
      const a = c.points[i]!;
      const b = c.points[i + 1] ?? a;
      return { at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, text: `${CABLE_LABELS[c.kind]} ${cableLength(c)} m`, colour: CABLE_COLOURS[c.kind] };
    }),
    ...d.markup.measurements.map((m) => ({ at: { x: (m.a.x + m.b.x) / 2, y: (m.a.y + m.b.y) / 2 }, text: metres(distance(m.a, m.b)), colour: INK })),
  ];
  // Five-metre scale bar in points.
  const bar = 5 * k;
  return (
    <Page size="A4" orientation="landscape" style={s.page}>
      <Header d={d} title="Solar PV design" />
      <View style={{ flexDirection: "row", gap: 16 }}>
        <View style={{ width: box, height: box, overflow: "hidden", borderRadius: 4, backgroundColor: "#dce5d2", position: "relative" }}>
          {aerial && (
            <Image
              src={{ data: aerial.data, format: "png" }}
              style={{ position: "absolute", left: (-aerial.widthM / 2 - vx) * k, top: (-aerial.widthM / 2 - vy) * k, width: aerial.widthM * k, height: aerial.widthM * k }}
            />
          )}
          <Svg width={box} height={box} viewBox={`${vx} ${vy} ${size} ${size}`} style={{ position: "absolute", left: 0, top: 0 }}>
            {d.segments.map((sg, i) => (
              <G key={i} transform={segTransform(sg)}>
                <Polygon points={pts(polygonOf(sg))} fill="#b9a898" fillOpacity={0.55} stroke="#8b7b6c" strokeWidth={0.06} />
                {sg.obstructions.map((o, j) => (
                  <Rect key={`o${j}`} x={o.x} y={o.y} width={o.w} height={o.h} fill="#8b7b6c" stroke="#DC6803" strokeWidth={0.06} />
                ))}
                {sg.panels.map((p, j) => (
                  <Rect key={j} x={p.x} y={p.y} width={p.w} height={p.h} fill="#1f2a44" stroke={p.s ? stringColour(p.s) : "#c7d2e0"} strokeWidth={p.s ? 0.1 : 0.03} />
                ))}
              </G>
            ))}
            {d.markup.cables.map((c) => (
              <G key={c.id}>
                <Polyline points={pts(c.points)} fill="none" stroke="#ffffff" strokeWidth={0.3} strokeLinejoin="round" strokeLinecap="round" />
                <Polyline points={pts(c.points)} fill="none" stroke={CABLE_COLOURS[c.kind]} strokeWidth={0.16} strokeLinejoin="round" strokeLinecap="round" />
              </G>
            ))}
            {d.markup.measurements.map((m) => (
              <G key={m.id}>
                <Line x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y} stroke={INK} strokeWidth={0.16} />
                <Line x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y} stroke="#ffffff" strokeWidth={0.07} strokeDasharray="0.3 0.15" />
              </G>
            ))}
            {d.markup.markers.map((m) => (
              <Circle key={m.id} cx={m.x} cy={m.y} r={0.75} fill="#ffffff" stroke={MARKER_COLOURS[m.kind]} strokeWidth={0.14} />
            ))}
          </Svg>
          {d.markup.markers.map((m) => {
            const at = px(m);
            return (
              <Text key={`c${m.id}`} style={{ position: "absolute", left: at.left - 12, top: at.top - 3.5, width: 24, textAlign: "center", fontSize: 6, fontFamily: "Helvetica-Bold", color: MARKER_COLOURS[m.kind] }}>
                {MARKER_CODES[m.kind]}
              </Text>
            );
          })}
          {labels.map((l, i) => {
            const at = px(l.at);
            return (
              <Text key={`l${i}`} style={{ position: "absolute", left: at.left - 60, top: at.top - 4, width: 120, textAlign: "center", fontSize: 6.5, fontFamily: "Helvetica-Bold", color: l.colour }}>
                <Text style={{ backgroundColor: "#ffffff" }}> {l.text} </Text>
              </Text>
            );
          })}
          <View style={{ position: "absolute", left: 10, bottom: 10, backgroundColor: "#ffffff", padding: 4, borderRadius: 3 }}>
            <View style={{ width: bar, height: 2, backgroundColor: INK }} />
            <Text style={{ fontSize: 6.5, marginTop: 2 }}>5 m</Text>
          </View>
          <View style={{ position: "absolute", right: 10, top: 10, backgroundColor: "#ffffff", padding: 4, borderRadius: 3 }}>
            <Text style={[s.bold, { fontSize: 8 }]}>N ^</Text>
          </View>
        </View>

        <View style={{ flex: 1 }}>
          <Text style={s.section}>SYSTEM</Text>
          <Row label="Panels" value={`${d.panelCount}${d.panelName ? ` × ${d.panelName}` : ""}`} />
          <Row label="System size" value={`${d.kWp.toFixed(2)} kWp`} />
          <Row label="Inverter" value={d.inverterName ?? "Not chosen"} />
          {d.batteryName && <Row label="Battery" value={`${d.batteryCount} × ${d.batteryName}`} />}
          {d.annualKwh !== null && <Row label="Annual generation (MCS)" value={`${d.annualKwh.toLocaleString("en-GB")} kWh`} />}

          <Text style={s.section}>ROOFS</Text>
          {d.segments.map((sg) => (
            <Row key={sg.id} label={sg.label.split(" · ")[0]!} value={`${sg.panels.length} panels · ${Math.round(sg.pitch)}° pitch · ${Math.round(sg.azimuth)}° az`} />
          ))}

          {d.strings.length > 0 && (
            <>
              <Text style={s.section}>{wired ? "STRINGS (WIRED ON PLAN)" : "STRINGS (AUTOMATIC SPLIT)"}</Text>
              {d.strings.map((x) => (
                <View key={x.n} style={s.key}>
                  {wired && <View style={{ width: 8, height: 8, borderWidth: 1.5, borderColor: stringColour(x.n) }} />}
                  <Text>
                    String {x.n}: {x.panels} panels, MPPT {x.mppt}
                  </Text>
                </View>
              ))}
            </>
          )}

          {d.markup.cables.length > 0 && (
            <>
              <Text style={s.section}>CABLE RUNS</Text>
              {d.markup.cables.map((c, i) => (
                <View key={c.id} style={s.key}>
                  <View style={{ width: 12, height: 2.5, backgroundColor: CABLE_COLOURS[c.kind] }} />
                  <Text>
                    {i + 1}. {CABLE_LABELS[c.kind]}: {cableLength(c)} m{c.extraM ? ` (incl. ${c.extraM} m extra)` : ""}
                  </Text>
                </View>
              ))}
            </>
          )}

          {d.markup.markers.length > 0 && (
            <>
              <Text style={s.section}>MARKED ON THE PLAN</Text>
              {d.markup.markers.map((m) => (
                <View key={m.id} style={s.key}>
                  <Text style={{ width: 18, fontFamily: "Helvetica-Bold", color: MARKER_COLOURS[m.kind] }}>{MARKER_CODES[m.kind]}</Text>
                  <Text style={{ flex: 1 }}>
                    {MARKER_LABELS[m.kind]}
                    {m.note ? `: ${m.note}` : ""}
                  </Text>
                </View>
              ))}
            </>
          )}
          <Text style={[s.small, { marginTop: 10 }]}>Plan distances are measured on the ground plan; roof slopes are longer. Cable lengths include the extra entered for drops and loops.</Text>
        </View>
      </View>
      <Footer d={d} />
    </Page>
  );
}

export function renderPlanPdf(d: DesignDoc, aerial: { data: Buffer; widthM: number } | null) {
  return renderToBuffer(
    <Document title={`Solar design, ${d.contactName}`} author={d.companyName}>
      <PlanPage d={d} aerial={aerial} />
    </Document>,
  );
}

// ---------------------------------------------------------------------------
// Single line diagram
// ---------------------------------------------------------------------------

function SvgBox({ x, y, w, h, title, lines, accent }: { x: number; y: number; w: number; h: number; title: string; lines: string[]; accent?: string }) {
  return (
    <G>
      <Rect x={x} y={y} width={w} height={h} rx={4} fill="#ffffff" stroke={accent ?? INK} strokeWidth={1} />
      <Text x={x + 6} y={y + 12} style={{ fontSize: 7.5, fontFamily: "Helvetica-Bold" }} fill={INK}>
        {title}
      </Text>
      {lines.map((l, i) => (
        <Text key={i} x={x + 6} y={y + 23 + i * 9.5} style={{ fontSize: 6.5 }} fill={INK3}>
          {l}
        </Text>
      ))}
    </G>
  );
}

function Wire({ points, label, colour = INK, at }: { points: Point[]; label?: string; colour?: string; at?: Point }) {
  return (
    <G>
      <Polyline points={pts(points)} fill="none" stroke={colour} strokeWidth={1.2} />
      {label && at && (
        <Text x={at.x} y={at.y} style={{ fontSize: 6 }} fill={INK3}>
          {label}
        </Text>
      )}
    </G>
  );
}

function SldPage({ d }: { d: DesignDoc }) {
  const m = d.sld;
  const dcTotal = m.cableTotals.find((c) => c.kind === "dc")?.lengthM;
  const acTotal = m.cableTotals.find((c) => c.kind === "ac")?.lengthM;
  const batTotal = m.cableTotals.find((c) => c.kind === "battery")?.lengthM;
  const evTotal = m.ev?.lengthM ?? m.cableTotals.find((c) => c.kind === "ev")?.lengthM ?? null;
  const W = 786;
  const H = 250;
  // Strings stacked down the left, grouped by MPPT input.
  const strings = m.strings.length ? m.strings : [{ n: 1, panels: d.panelCount, mppt: 1, kWp: null, vocColdV: null, iscA: null }];
  const sh = Math.min(44, (H - 20) / strings.length - 6);
  // Centred on the inverter's line (y 118).
  const sTop = Math.max(4, 118 - (strings.length * (sh + 6) - 6) / 2);
  const sy = (i: number) => sTop + i * (sh + 6);
  const mppts = [...new Set(strings.map((x) => x.mppt))];
  const isoY = (mppt: number) => {
    const on = strings.map((x, i) => (x.mppt === mppt ? i : -1)).filter((i) => i >= 0);
    return (sy(on[0]!) + sy(on.at(-1)!) + sh) / 2;
  };
  const inv = { x: 290, y: 70, w: 100, h: 96 };
  const midY = inv.y + inv.h / 2;
  const acIso = { x: 450, y: midY - 22, w: 64, h: 44 };
  const gen = { x: 530, y: midY - 22, w: 68, h: 44 };
  const cu = { x: 612, y: midY - 45, w: 80, h: 90 };
  const meter = { x: 712, y: midY - 22, w: 66, h: 44 };
  // The DNO supply sits above the meter, leaving room below the consumer unit for the EV branch.
  const dno = { x: meter.x - 18, y: meter.y - 72, w: 84, h: 52 };
  const dcCoupled = m.battery?.coupling === "dc";
  const bat = dcCoupled ? { x: inv.x, y: inv.y + inv.h + 34, w: inv.w, h: 44 } : { x: cu.x - 105, y: cu.y + cu.h + 34, w: 95, h: 44 };
  const evBox = { x: cu.x, y: cu.y + cu.h + 34, w: 90, h: 58 };
  const stringsBottom = sy(strings.length - 1) + sh;
  const svgH = Math.max(stringsBottom + 22, (m.battery ? bat.y + bat.h : 0) + 6, (m.ev ? evBox.y + evBox.h : 0) + 6, meter.y + meter.h + 6);
  const v = (n: number | null | undefined, unit: string) => (n == null ? `${BLANK} ${unit}` : `${n} ${unit}`);
  return (
    <Page size="A4" orientation="landscape" style={s.page}>
      <Header d={d} title="Single line diagram" />
      <Svg width={W} height={svgH} viewBox={`0 0 ${W} ${svgH}`}>
        {strings.map((x, i) => (
          <G key={x.n}>
            <SvgBox
              x={0}
              y={sy(i)}
              w={150}
              h={sh}
              accent={d.wiredByHand ? stringColour(x.n) : undefined}
              title={`String ${x.n}: ${x.panels} × ${m.panel?.name ?? "panel"}`}
              lines={sh > 36 ? [`${x.kWp ?? BLANK} kWp · Voc cold ${x.vocColdV ?? BLANK} V`, `Isc ${x.iscA ?? BLANK} A`] : [`Voc cold ${x.vocColdV ?? BLANK} V · Isc ${x.iscA ?? BLANK} A`]}
            />
            <Wire points={[{ x: 150, y: sy(i) + sh / 2 }, { x: 175, y: sy(i) + sh / 2 }, { x: 175, y: isoY(x.mppt) }, { x: 190, y: isoY(x.mppt) }]} colour="#e5484d" />
          </G>
        ))}
        {mppts.map((mp) => (
          <G key={mp}>
            <SvgBox x={190} y={isoY(mp) - 16} w={80} h={32} title={`DC isolator, MPPT ${mp}`} lines={[`${BLANK} A / ${BLANK} V DC`]} />
            <Wire points={[{ x: 270, y: isoY(mp) }, { x: 285, y: isoY(mp) }, { x: 285, y: midY }, { x: inv.x, y: midY }]} colour="#e5484d" />
          </G>
        ))}
        <Text x={0} y={stringsBottom + 14} style={{ fontSize: 6 }} fill={INK3}>
          DC cable {BLANK} mm²{dcTotal ? `, ${dcTotal} m on plan` : ""}
        </Text>
        <SvgBox
          x={inv.x}
          y={inv.y}
          w={inv.w}
          h={inv.h}
          title={m.inverter?.hybrid ? "Hybrid inverter" : "Inverter"}
          lines={[m.inverter?.name ?? "Not chosen", v(m.inverter?.acKw, "kW AC"), `MPPT inputs: ${m.inverter?.mpptCount ?? BLANK}`, `${m.inverter?.phases === 3 ? "Three" : m.inverter?.phases === 1 ? "Single" : BLANK} phase`]}
        />
        <Wire points={[{ x: inv.x + inv.w, y: midY }, { x: acIso.x, y: midY }]} label={`AC ${BLANK} mm²`} at={{ x: inv.x + inv.w + 2, y: midY + 10 }} />
        {acTotal ? (
          <Text x={inv.x + inv.w + 2} y={midY + 18} style={{ fontSize: 6 }} fill={INK3}>
            {acTotal} m on plan
          </Text>
        ) : null}
        <SvgBox x={acIso.x} y={acIso.y} w={acIso.w} h={acIso.h} title="AC isolator" lines={[`${BLANK} A`]} />
        <Wire points={[{ x: acIso.x + acIso.w, y: midY }, { x: gen.x, y: midY }]} />
        <SvgBox x={gen.x} y={gen.y} w={gen.w} h={gen.h} title="Generation meter" lines={["MID approved"]} />
        <Wire points={[{ x: gen.x + gen.w, y: midY }, { x: cu.x, y: midY }]} />
        <SvgBox x={cu.x} y={cu.y} w={cu.w} h={cu.h} title="Consumer unit" lines={[`PV circuit ${BLANK} A`, ...(m.battery && !dcCoupled ? [`Battery ${BLANK} A`] : []), ...(m.ev ? [`EV circuit ${m.ev.protection ?? `${BLANK} A`}`] : [])]} />
        <Wire points={[{ x: cu.x + cu.w, y: midY }, { x: meter.x, y: midY }]} />
        <SvgBox x={meter.x} y={meter.y} w={meter.w} h={meter.h} title="Supply meter" lines={["To DNO cut-out"]} />
        <SvgBox
          x={dno.x}
          y={dno.y}
          w={dno.w}
          h={dno.h}
          title="DNO supply"
          lines={[`${m.supply.phases === 3 ? "Three" : "Single"} phase`, `Main fuse ${v(m.supply.mainFuseA, "A")}`, `Earthing ${m.supply.earthing ?? BLANK}`]}
        />
        <Wire points={[{ x: meter.x + meter.w / 2, y: meter.y }, { x: meter.x + meter.w / 2, y: dno.y + dno.h }]} />
        {m.battery && (
          <G>
            <SvgBox
              x={bat.x}
              y={bat.y}
              w={bat.w}
              h={bat.h}
              title={dcCoupled ? "Battery (DC coupled)" : "Battery (AC coupled)"}
              lines={[`${m.battery.count} × ${m.battery.name}`, v(m.battery.usableKwh === null ? null : Math.round(m.battery.usableKwh * m.battery.count * 10) / 10, "kWh usable")]}
            />
            {dcCoupled ? (
              <Wire points={[{ x: inv.x + inv.w / 2, y: inv.y + inv.h }, { x: inv.x + inv.w / 2, y: bat.y }]} label={`Battery DC ${BLANK} mm²${batTotal ? `, ${batTotal} m` : ""}`} at={{ x: inv.x + inv.w / 2 + 4, y: inv.y + inv.h + 22 }} />
            ) : (
              <Wire points={[{ x: bat.x + bat.w, y: bat.y + bat.h / 2 }, { x: cu.x + 15, y: bat.y + bat.h / 2 }, { x: cu.x + 15, y: cu.y + cu.h }]} />
            )}
          </G>
        )}
        {m.ev && (
          <G>
            <SvgBox
              x={evBox.x}
              y={evBox.y}
              w={evBox.w}
              h={evBox.h}
              accent="#12a150"
              title="EV charger"
              lines={[m.ev.name, v(m.ev.kw, "kW"), `Cable ${v(m.ev.cableMm2, "mm²")}`, `Run ${v(evTotal, "m")}`]}
            />
            <Wire points={[{ x: cu.x + cu.w - 20, y: cu.y + cu.h }, { x: cu.x + cu.w - 20, y: evBox.y }]} colour="#12a150" />
          </G>
        )}
      </Svg>

      <View style={{ flexDirection: "row", gap: 24, marginTop: 4 }}>
        <View style={{ flex: 1 }}>
          <Text style={s.section}>TO CONFIRM ON SITE</Text>
          <Text style={s.small}>Values shown as {BLANK} aren&apos;t in the design. Fill them in from the installation; they&apos;re never assumed.</Text>
          {m.blanks.map((b) => (
            <Text key={b} style={s.small}>
              - {b}
            </Text>
          ))}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.section}>DESIGN</Text>
          <Text style={s.small}>
            {d.panelCount} panels, {d.kWp.toFixed(2)} kWp, {d.strings.length} string{d.strings.length === 1 ? "" : "s"} {d.wiredByHand ? "as wired on the plan" : "(automatic split)"}.
          </Text>
          {d.notes.slice(0, 6).map((n) => (
            <Text key={n} style={s.small}>
              - {n}
            </Text>
          ))}
          <Text style={[s.small, { marginTop: 6 }]}>Schematic only; it doesn&apos;t replace the electrical installation certificate.</Text>
        </View>
      </View>
      <Footer d={d} />
    </Page>
  );
}

export function renderSldPdf(d: DesignDoc) {
  return renderToBuffer(
    <Document title={`Single line diagram, ${d.contactName}`} author={d.companyName}>
      <SldPage d={d} />
    </Document>,
  );
}
