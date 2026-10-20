import "server-only";
import { formatPence, paybackYears, proposalReference, proposalTotals, SECTION_LABELS, type ProposalSection } from "@goinstall/core";
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { initials, type ProposalView } from "@/components/proposal-document";
import { proposalView, type ProposalContent } from "./proposals";
import { formatDate } from "./utils";

const INK = "#101828";
const INK3 = "#475467";
const LINE = "#e4e7ec";

function styles(brand: string) {
  return StyleSheet.create({
    page: { padding: 40, fontSize: 10, color: INK, fontFamily: "Helvetica" },
    header: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: LINE, paddingBottom: 14, marginBottom: 18 },
    logo: { width: 30, height: 30, borderRadius: 6, backgroundColor: brand, color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 11, textAlign: "center", paddingTop: 9 },
    bold: { fontFamily: "Helvetica-Bold" },
    muted: { color: INK3 },
    title: { fontSize: 17, fontFamily: "Helvetica-Bold", marginBottom: 3 },
    tiles: { flexDirection: "row", gap: 8, marginVertical: 14 },
    tile: { flex: 1, backgroundColor: "#f9fafb", borderRadius: 6, padding: 9 },
    tileValue: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 3 },
    section: { fontSize: 8, fontFamily: "Helvetica-Bold", color: INK3, letterSpacing: 0.8, marginTop: 12, marginBottom: 2 },
    line: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 6 },
    totals: { marginTop: 14, marginLeft: "auto", width: 220 },
    totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
    deposit: { flexDirection: "row", justifyContent: "space-between", backgroundColor: "#e6f4ef", color: brand, fontFamily: "Helvetica-Bold", padding: 7, borderRadius: 5, marginTop: 6 },
    terms: { marginTop: 22, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 10, fontSize: 8, color: INK3, lineHeight: 1.4 },
    footer: { position: "absolute", bottom: 22, left: 40, right: 40, fontSize: 8, color: INK3, flexDirection: "row", justifyContent: "space-between" },
  });
}

export interface PdfExtras {
  brandColour: string | null;
  contact: string[];
  bank: { name: string | null; sortCode: string | null; account: string | null };
  paymentTerms: string | null;
  acceptance: { name: string; at: Date } | null;
}

function ProposalPdf({ p, x }: { p: ProposalView; x: PdfExtras }) {
  const s = styles(x.brandColour && /^#[0-9a-f]{6}$/i.test(x.brandColour) ? x.brandColour : "#0B7A62");
  const t = proposalTotals(p.lines, p.depositPct);
  const payback = paybackYears(t.totalPence, p.summary.yearlySavingPence ?? null);
  const tiles = [
    p.summary.kWp ? ["System size", `${Number(p.summary.kWp).toFixed(2)} kWp`] : null,
    p.summary.annualKwh ? ["Generation", `${Math.round(p.summary.annualKwh).toLocaleString("en-GB")} kWh a year`] : null,
    p.summary.yearlySavingPence ? ["Yearly saving", formatPence(Math.round(p.summary.yearlySavingPence / 100) * 100)] : null,
    payback ? ["Payback", `${payback} years`] : null,
  ].filter((r): r is string[] => Boolean(r));
  const ref = proposalReference(p.documentPrefix, p.number, p.version);
  return (
    <Document title={`${p.companyName} proposal ${ref}`} author={p.companyName}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Text style={s.logo}>{initials(p.companyName)}</Text>
            <View>
              <Text style={s.bold}>{p.companyName}</Text>
              <Text style={s.muted}>{p.mcsNumber ? `MCS certified installer · ${p.mcsNumber}` : "Installer"}</Text>
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.muted}>Proposal {ref}</Text>
            {p.validUntil && <Text style={s.muted}>Valid until {formatDate(p.validUntil, { day: "numeric", month: "long", year: "numeric" })}</Text>}
          </View>
        </View>
        <Text style={s.title}>{p.title}</Text>
        <Text style={s.muted}>Prepared for {p.contactName}</Text>
        {p.intro && <Text style={{ marginTop: 8, lineHeight: 1.4 }}>{p.intro}</Text>}
        {tiles.length > 0 && (
          <View style={s.tiles}>
            {tiles.map(([label, value]) => (
              <View key={label} style={s.tile}>
                <Text style={s.muted}>{label}</Text>
                <Text style={s.tileValue}>{value}</Text>
              </View>
            ))}
          </View>
        )}
        {(Object.keys(SECTION_LABELS) as ProposalSection[]).map((sec) => {
          const lines = p.lines.filter((l) => l.section === sec);
          if (!lines.length) return null;
          return (
            <View key={sec} wrap={false}>
              <Text style={s.section}>{SECTION_LABELS[sec].toUpperCase()}</Text>
              {lines.map((l) => {
                const total = Math.round(l.quantity * l.unitPricePence);
                return (
                  <View key={l.id} style={s.line}>
                    <Text style={{ maxWidth: 400 }}>
                      {l.quantity !== 1 && !/^\d+\s*×/.test(l.description) ? `${l.quantity} × ` : ""}
                      {l.description}
                    </Text>
                    <Text>{total < 0 ? `-${formatPence(-total)}` : formatPence(total)}</Text>
                  </View>
                );
              })}
            </View>
          );
        })}
        <View style={s.totals} wrap={false}>
          <View style={s.totalRow}>
            <Text style={s.muted}>Subtotal</Text>
            <Text>{formatPence(t.subtotalPence)}</Text>
          </View>
          {t.vatByRate.map((r) => (
            <View key={r.rate} style={s.totalRow}>
              <Text style={s.muted}>VAT at {r.rate}%</Text>
              <Text>{formatPence(r.vatPence)}</Text>
            </View>
          ))}
          <View style={[s.totalRow, { marginTop: 4 }]}>
            <Text style={[s.bold, { fontSize: 14 }]}>Total</Text>
            <Text style={[s.bold, { fontSize: 14 }]}>{formatPence(t.totalPence)}</Text>
          </View>
          {t.depositPence > 0 && (
            <View style={s.deposit}>
              <Text>Deposit to confirm ({p.depositPct}%)</Text>
              <Text>{formatPence(t.depositPence)}</Text>
            </View>
          )}
        </View>
        {(x.bank.account || x.paymentTerms) && (
          <View style={{ marginTop: 16 }} wrap={false}>
            <Text style={s.bold}>Paying</Text>
            {x.bank.account && (
              <Text style={s.muted}>
                Bank transfer: {x.bank.name ?? p.companyName}, sort code {x.bank.sortCode}, account {x.bank.account}. Reference {proposalReference(p.documentPrefix, p.number)}.
              </Text>
            )}
            {x.paymentTerms && <Text style={s.muted}>{x.paymentTerms}</Text>}
          </View>
        )}
        {x.acceptance && (
          <Text style={{ marginTop: 12 }}>
            Accepted by {x.acceptance.name} on {formatDate(x.acceptance.at, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}.
          </Text>
        )}
        {p.terms && (
          <View style={s.terms}>
            <Text style={[s.bold, { color: INK, marginBottom: 4 }]}>Terms and conditions</Text>
            <Text>{p.terms}</Text>
          </View>
        )}
        <View style={s.footer} fixed>
          <Text>{x.contact.join(" · ")}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export function renderProposalPdf(p: ProposalView, x: PdfExtras) {
  return renderToBuffer(<ProposalPdf p={p} x={x} />);
}

/** The PDF for a loaded proposal as a download response. */
export async function proposalPdfResponse(c: ProposalContent) {
  const p = c.proposal;
  const buf = await renderProposalPdf(proposalView(c), {
    brandColour: p.brand_primary_colour,
    contact: [p.company_phone, p.company_email, p.company_website].filter((v): v is string => Boolean(v)),
    bank: { name: p.bank_account_name, sortCode: p.bank_sort_code, account: p.bank_account_number },
    paymentTerms: p.payment_terms,
    acceptance: p.accepted_at && p.accepted_name ? { name: p.accepted_name, at: p.accepted_at } : null,
  });
  const name = `${proposalReference(p.document_prefix, p.number)}-v${p.version}.pdf`;
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" },
  });
}
