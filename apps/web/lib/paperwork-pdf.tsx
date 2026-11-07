import "server-only";
import { BOARD_FIELDS, circuitGroups, missingValues, PAPERWORK_TITLES, TIMING_LABELS, type FormValue, type PaperworkKind, type PaperworkTiming, type TestValues } from "@goinstall/core";
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate } from "./utils";

const INK = "#101828";
const INK3 = "#475467";
const LINE = "#e4e7ec";

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 9.5, color: INK, fontFamily: "Helvetica" },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: LINE, paddingBottom: 10, marginBottom: 14 },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: INK3 },
  h: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 4 },
  label: { width: 210, color: INK3, paddingRight: 8 },
  value: { flex: 1 },
  source: { width: 110, color: INK3, fontSize: 7.5, textAlign: "right" },
  gap: { color: "#B54708", fontFamily: "Helvetica-Bold" },
  note: { marginTop: 14, fontSize: 8, color: INK3, lineHeight: 1.4 },
  footer: { position: "absolute", bottom: 20, left: 40, right: 40, fontSize: 7, color: INK3, flexDirection: "row", justifyContent: "space-between" },
});

/** What each generated sheet is called: these are GoInstall's details sheets, not the official forms. */
export const SHEET_TITLES: Record<PaperworkKind, string> = {
  g98_notification: "Details for the G98 notification (ENA form)",
  g99_application: "Details for the G99 application (ENA form)",
  ev_dno_notification: "Details for the EV charger notification (ENA form)",
  mcs_certificate: "Details for the MCS certificate",
  eic: "Test readings for the electrical installation certificate",
  warranty_registration: "Warranty registration details",
  handover_pack: "Customer handover pack",
};

const NOTES: Partial<Record<PaperworkKind, string>> = {
  g98_notification: "Copy these into the DNO's portal or the ENA standard form, then record the DNO reference in GoInstall.",
  g99_application: "Copy these into the DNO's portal or the ENA standard form, then record the DNO reference in GoInstall. The install waits for approval.",
  ev_dno_notification: "Copy these into the DNO's portal or the ENA standard form, then record the DNO reference in GoInstall.",
  mcs_certificate: "Enter these in the MCS Installation Database to issue the certificate, then upload it and record its number in GoInstall.",
  eic: "Readings as captured in the installer app, for the electrician's certificate software. Upload the signed certificate to GoInstall.",
};

export interface SheetInput {
  kind: PaperworkKind;
  title: string;
  timing: PaperworkTiming;
  companyName: string;
  brand: string;
  customerName: string;
  siteAddress: string;
  values: FormValue[];
  generatedAt: Date;
}

function Sheet({ d }: { d: SheetInput }) {
  const gaps = missingValues(d.values);
  return (
    <Page size="A4" style={s.page}>
      <View style={s.header}>
        <View>
          <Text style={s.h}>{SHEET_TITLES[d.kind]}</Text>
          <Text style={s.muted}>
            {d.customerName}
            {d.siteAddress ? ` · ${d.siteAddress}` : ""}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[s.bold, { color: d.brand }]}>{d.companyName}</Text>
          <Text style={s.muted}>
            {d.title === PAPERWORK_TITLES[d.kind] ? TIMING_LABELS[d.timing] : d.title} · {formatDate(d.generatedAt, { day: "numeric", month: "long", year: "numeric" })}
          </Text>
        </View>
      </View>
      {d.values.map((v) => (
        <View key={v.key} style={s.row} wrap={false}>
          <Text style={s.label}>{v.label}</Text>
          <Text style={[s.value, v.value ? {} : s.gap]}>{v.value ?? "Not known yet"}</Text>
          <Text style={s.source}>{v.source}</Text>
        </View>
      ))}
      {gaps.length > 0 && <Text style={[s.note, { color: "#B54708" }]}>Still to fill in: {gaps.join(", ")}.</Text>}
      {NOTES[d.kind] && <Text style={s.note}>{NOTES[d.kind]}</Text>}
      <View style={s.footer} fixed>
        <Text>{d.companyName} · prepared by GoInstall from the survey, design and install</Text>
        <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </View>
    </Page>
  );
}

export function renderSheetPdf(d: SheetInput) {
  return renderToBuffer(
    <Document title={`${SHEET_TITLES[d.kind]}, ${d.customerName}`} author={d.companyName}>
      <Sheet d={d} />
    </Document>,
  );
}

export interface HandoverCover {
  companyName: string;
  brand: string;
  companyContact: string[];
  customerName: string;
  siteAddress: string;
  completedAt: Date | null;
  system: [string, string][];
  contents: string[];
  warranties: { name: string; serials: string[]; years: number | null }[];
}

/** First pages of the handover pack: what's installed, what's in the pack, warranties. */
export function renderHandoverCover(c: HandoverCover) {
  return renderToBuffer(
    <Document title={`Handover pack, ${c.customerName}`} author={c.companyName}>
      <Page size="A4" style={s.page}>
        <Text style={[s.bold, { color: c.brand, fontSize: 11 }]}>{c.companyName}</Text>
        <Text style={{ fontSize: 22, fontFamily: "Helvetica-Bold", marginTop: 60 }}>Your handover pack</Text>
        <Text style={{ fontSize: 12, marginTop: 6 }}>{c.customerName}</Text>
        <Text style={s.muted}>{c.siteAddress}</Text>
        {c.completedAt && <Text style={[s.muted, { marginTop: 4 }]}>Installed {formatDate(c.completedAt, { day: "numeric", month: "long", year: "numeric" })}</Text>}
        <Text style={{ fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 36, marginBottom: 6 }}>Your system</Text>
        {c.system.map(([k, v]) => (
          <View key={k} style={s.row}>
            <Text style={s.label}>{k}</Text>
            <Text style={s.value}>{v}</Text>
          </View>
        ))}
        <Text style={{ fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 24, marginBottom: 6 }}>In this pack</Text>
        {c.contents.map((x, i) => (
          <Text key={x} style={{ marginBottom: 3 }}>
            {i + 1}. {x}
          </Text>
        ))}
        <View style={s.footer} fixed>
          <Text>{c.companyContact.join(" · ")}</Text>
          <Text render={({ pageNumber }) => `${pageNumber}`} />
        </View>
      </Page>
      {c.warranties.length > 0 && (
        <Page size="A4" style={s.page}>
          <Text style={s.h}>Warranties</Text>
          <Text style={[s.muted, { marginBottom: 12 }]}>Keep these serial numbers: the manufacturer will ask for them.</Text>
          {c.warranties.map((w) => (
            <View key={w.name} style={s.row} wrap={false}>
              <Text style={s.label}>{w.name}</Text>
              <Text style={s.value}>{w.serials.length ? `Serial ${w.serials.join(", ")}` : "Serial not recorded"}</Text>
              <Text style={s.source}>{w.years ? `${w.years}-year product warranty` : ""}</Text>
            </View>
          ))}
          <View style={s.footer} fixed>
            <Text>{c.companyContact.join(" · ")}</Text>
            <Text render={({ pageNumber }) => `${pageNumber}`} />
          </View>
        </Page>
      )}
    </Document>,
  );
}

/** The PDF's built-in font has no tick or cross. */
const pdfText = (v: string | null | undefined) =>
  (v ?? "")
    .replace(/✓/g, "OK")
    .replace(/✗/g, "X")
    .replace(/Ω/g, "ohm")
    .replace(/Δ/g, "d");

export interface TestResultsDoc {
  companyName: string;
  customerName: string;
  siteAddress: string;
  boards: { title: string; board: TestValues; circuits: TestValues[]; recordedBy: string | null; recordedAt: Date }[];
}

const t = StyleSheet.create({
  page: { padding: 24, fontSize: 6.5, color: INK, fontFamily: "Helvetica" },
  cell: { borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: "#98a2b3", paddingHorizontal: 2, paddingVertical: 2.5 },
  head: { backgroundColor: "#eef0f6", fontFamily: "Helvetica-Bold" },
});

/** The schedule of circuits and test results, one landscape page (or more) per board, laid out like the certificate's continuation sheet. */
export function renderTestResultsPdf(d: TestResultsDoc) {
  const groups = circuitGroups();
  const fields = groups.flatMap((g) => g.fields);
  const width = (key: string) => (key === "designation" ? 92 : key === "ocpd_bsen" || key === "wiring_type" ? 34 : 27.5);
  return renderToBuffer(
    <Document title={`Electrical test results, ${d.customerName}`} author={d.companyName}>
      {d.boards.map((b) => (
        <Page key={b.title} size="A4" orientation="landscape" style={t.page}>
          <View style={[s.header, { marginBottom: 8, paddingBottom: 6 }]}>
            <View>
              <Text style={[s.bold, { fontSize: 11 }]}>Distribution board: {b.title}</Text>
              <Text style={s.muted}>
                {d.customerName} · {d.siteAddress}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={s.bold}>{d.companyName}</Text>
              <Text style={s.muted}>
                Recorded {b.recordedBy ? `by ${b.recordedBy} ` : ""}
                {formatDate(b.recordedAt, { day: "numeric", month: "long", year: "numeric" })}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 8 }}>
            {BOARD_FIELDS.map((f) => (
              <View key={f.key} style={{ width: "25%", flexDirection: "row", paddingVertical: 1.5, paddingRight: 6 }}>
                <Text style={[s.muted, { width: "58%" }]}>
                  {pdfText(f.label)}
                  {f.unit ? ` (${pdfText(f.unit)})` : ""}
                </Text>
                <Text style={s.bold}>{pdfText(b.board[f.key]) || "-"}</Text>
              </View>
            ))}
          </View>
          <View style={{ borderTopWidth: 0.5, borderLeftWidth: 0.5, borderColor: "#98a2b3" }}>
            <View style={{ flexDirection: "row" }} fixed>
              {groups.map((g) => (
                <Text key={g.group} style={[t.cell, t.head, { width: g.fields.reduce((n, f) => n + width(f.key), 0) }]}>
                  {pdfText(g.group)}
                </Text>
              ))}
            </View>
            <View style={{ flexDirection: "row" }} fixed>
              {fields.map((f) => (
                <Text key={f.key} style={[t.cell, t.head, { width: width(f.key) }]}>
                  {pdfText(f.short)}
                  {f.unit ? `\n${pdfText(f.unit)}` : ""}
                </Text>
              ))}
            </View>
            {b.circuits.map((c, i) => (
              <View key={i} style={{ flexDirection: "row" }} wrap={false}>
                {fields.map((f) => (
                  <Text key={f.key} style={[t.cell, { width: width(f.key) }]}>
                    {pdfText(c[f.key])}
                  </Text>
                ))}
              </View>
            ))}
          </View>
          {b.circuits.length === 0 && <Text style={[s.muted, { marginTop: 6 }]}>No circuits recorded.</Text>}
          <View style={s.footer} fixed>
            <Text>Electrical test results · {d.companyName}</Text>
            <Text render={({ pageNumber }) => `${pageNumber}`} />
          </View>
        </Page>
      ))}
    </Document>,
  );
}

export interface ChecksDoc {
  companyName: string;
  items: { title: string; who: string; done: boolean; serial: string | null; readings: string[]; note: string | null }[];
  signoff: { name: string; at: Date | null } | null;
}

/** The installer's commissioning checks, readings and serial numbers. */
export function renderChecksPdf(d: ChecksDoc) {
  return renderToBuffer(
    <Document title="Commissioning checks" author={d.companyName}>
      <Page size="A4" style={s.page}>
        <Text style={s.h}>Commissioning checks and readings</Text>
        <Text style={[s.muted, { marginBottom: 12 }]}>Recorded by the installer on the day.</Text>
        {d.items.map((i, n) => (
          <View key={`${i.title}-${n}`} style={[s.row, { flexDirection: "column", gap: 2 }]} wrap={false}>
            <Text style={s.bold}>
              {i.title}
              {i.done ? "" : " (not done)"}
              <Text style={[s.muted, { fontFamily: "Helvetica" }]}> · {i.who}</Text>
            </Text>
            {i.serial && <Text>Serial: {i.serial}</Text>}
            {i.readings.length > 0 && <Text>{pdfText(i.readings.join(" · "))}</Text>}
            {i.note && <Text style={s.muted}>{i.note}</Text>}
          </View>
        ))}
        {d.signoff && (
          <Text style={{ marginTop: 14 }}>
            Signed off by {d.signoff.name}
            {d.signoff.at ? ` on ${formatDate(d.signoff.at, { day: "numeric", month: "long", year: "numeric" })}` : ""}.
          </Text>
        )}
        <View style={s.footer} fixed>
          <Text>{d.companyName}</Text>
          <Text render={({ pageNumber }) => `${pageNumber}`} />
        </View>
      </Page>
    </Document>,
  );
}
