import "server-only";
import { missingValues, PAPERWORK_TITLES, TIMING_LABELS, type FormValue, type PaperworkKind, type PaperworkTiming } from "@goinstall/core";
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
