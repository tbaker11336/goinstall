import "server-only";
import { formatPence } from "@goinstall/core";
import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate } from "./utils";

export interface InvoiceDoc {
  number: string;
  kind: string;
  status: string;
  title: string;
  amountPence: number;
  vatPence: number;
  issuedAt: Date;
  dueDate: Date | string | null;
  paidAt: Date | null;
  company: {
    name: string;
    brand: string;
    address: string | null;
    contact: string[];
    vatNumber: string | null;
    companyNumber: string | null;
    bank: { name: string; sortCode: string | null; account: string } | null;
    paymentTerms: string | null;
  };
  logo: { data: Buffer; format: "png" | "jpg" } | null;
  customer: { name: string; company: string | null; address: string | null };
  site: string | null;
  quoteRef: string | null;
}

const INK = "#101828";
const INK3 = "#475467";
const LINE = "#e4e7ec";
const s = StyleSheet.create({
  page: { padding: 44, fontSize: 10, color: INK, fontFamily: "Helvetica" },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: INK3 },
  label: { fontSize: 8, color: INK3, fontFamily: "Helvetica-Bold", letterSpacing: 0.6, marginBottom: 3 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
});
const day = (d: Date | string) => formatDate(d, { day: "numeric", month: "long", year: "numeric" });

/** A one-page invoice: company and logo, customer, what it's for, net / VAT / total, and how to pay. */
export function renderInvoicePdf(d: InvoiceDoc) {
  const net = d.amountPence - d.vatPence;
  return renderToBuffer(
    <Document title={`Invoice ${d.number}`} author={d.company.name}>
      <Page size="A4" style={s.page}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
          <View style={{ maxWidth: 260 }}>
            {d.logo ? <Image src={d.logo} style={{ height: 42, maxWidth: 180, objectFit: "contain", marginBottom: 8 }} /> : <Text style={[s.bold, { fontSize: 14, color: d.company.brand, marginBottom: 6 }]}>{d.company.name}</Text>}
            {d.logo && <Text style={s.bold}>{d.company.name}</Text>}
            {d.company.address && <Text style={s.muted}>{d.company.address}</Text>}
            {d.company.contact.map((c) => (
              <Text key={c} style={s.muted}>
                {c}
              </Text>
            ))}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 22, fontFamily: "Helvetica-Bold", color: d.company.brand }}>INVOICE</Text>
            <Text style={[s.bold, { marginTop: 4 }]}>{d.number}</Text>
            <Text style={s.muted}>Date: {day(d.issuedAt)}</Text>
            {d.dueDate && <Text style={s.muted}>Due: {day(d.dueDate)}</Text>}
            {d.quoteRef && <Text style={s.muted}>Quote: {d.quoteRef}</Text>}
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 24, marginBottom: 24 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>BILL TO</Text>
            <Text style={s.bold}>{d.customer.name}</Text>
            {d.customer.company && <Text>{d.customer.company}</Text>}
            {d.customer.address && <Text style={s.muted}>{d.customer.address}</Text>}
          </View>
          {d.site && (
            <View style={{ flex: 1 }}>
              <Text style={s.label}>INSTALLATION ADDRESS</Text>
              <Text>{d.site}</Text>
            </View>
          )}
        </View>

        <View style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: LINE, paddingVertical: 8, flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={s.label}>DESCRIPTION</Text>
          <Text style={s.label}>AMOUNT</Text>
        </View>
        <View style={[s.row, { borderBottomWidth: 0.5, borderColor: LINE, paddingVertical: 10 }]}>
          <Text style={{ maxWidth: 380 }}>{d.title}</Text>
          <Text>{formatPence(net)}</Text>
        </View>

        <View style={{ marginLeft: "auto", width: 220, marginTop: 12 }}>
          <View style={s.row}>
            <Text style={s.muted}>Net</Text>
            <Text>{formatPence(net)}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.muted}>VAT</Text>
            <Text>{formatPence(d.vatPence)}</Text>
          </View>
          <View style={[s.row, { borderTopWidth: 1, borderColor: INK, marginTop: 4, paddingTop: 6 }]}>
            <Text style={[s.bold, { fontSize: 13 }]}>Total due</Text>
            <Text style={[s.bold, { fontSize: 13 }]}>{formatPence(d.amountPence)}</Text>
          </View>
          {d.status === "paid" && (
            <Text style={[s.bold, { marginTop: 8, color: "#067647", textAlign: "right" }]}>PAID{d.paidAt ? ` ${day(d.paidAt)}` : ""}. Thank you.</Text>
          )}
        </View>

        {d.status !== "paid" && (d.company.bank || d.company.paymentTerms) && (
          <View style={{ marginTop: 32, backgroundColor: "#f9fafb", borderRadius: 6, padding: 12 }}>
            <Text style={s.label}>HOW TO PAY</Text>
            {d.company.bank && (
              <Text>
                Bank transfer to {d.company.bank.name}, sort code {d.company.bank.sortCode}, account {d.company.bank.account}. Reference {d.number}.
              </Text>
            )}
            <Text style={s.muted}>Or pay by card from the link in your email.</Text>
            {d.company.paymentTerms && <Text style={[s.muted, { marginTop: 4 }]}>{d.company.paymentTerms}</Text>}
          </View>
        )}

        <View style={{ position: "absolute", bottom: 26, left: 44, right: 44, fontSize: 8, color: INK3, flexDirection: "row", justifyContent: "space-between" }} fixed>
          <Text>{[d.company.name, d.company.companyNumber ? `Company no. ${d.company.companyNumber}` : null, d.company.vatNumber ? `VAT no. ${d.company.vatNumber}` : null].filter(Boolean).join(" · ")}</Text>
          <Text>{d.number}</Text>
        </View>
      </Page>
    </Document>,
  );
}
