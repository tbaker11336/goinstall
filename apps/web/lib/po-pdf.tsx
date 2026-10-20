import "server-only";
import { formatPence } from "@goinstall/core";
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate } from "./utils";

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: "#101828", fontFamily: "Helvetica" },
  h: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  muted: { color: "#475467" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e4e7ec", paddingVertical: 5 },
  th: { fontFamily: "Helvetica-Bold", color: "#475467", fontSize: 8 },
});

export interface PoPdf {
  reference: string;
  companyName: string;
  companyContact: string[];
  supplierName: string;
  accountNumber: string | null;
  deliveryAddress: string;
  expectedDate: string | null;
  lines: { description: string; sku: string | null; quantity: number; unitCostPence: number }[];
  notes: string | null;
}

function Po({ po }: { po: PoPdf }) {
  const total = po.lines.reduce((n, l) => n + Math.round(l.quantity * l.unitCostPence), 0);
  const col = [{ flex: 4 }, { flex: 2 }, { flex: 1, textAlign: "right" as const }, { flex: 1.5, textAlign: "right" as const }, { flex: 1.5, textAlign: "right" as const }];
  return (
    <Document title={`Purchase order ${po.reference}`} author={po.companyName}>
      <Page size="A4" style={s.page}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 20 }}>
          <View>
            <Text style={s.h}>Purchase order {po.reference}</Text>
            <Text>{po.companyName}</Text>
            {po.companyContact.map((c) => (
              <Text key={c} style={s.muted}>
                {c}
              </Text>
            ))}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>To: {po.supplierName}</Text>
            {po.accountNumber && <Text style={s.muted}>Account {po.accountNumber}</Text>}
            <Text style={s.muted}>Date {formatDate(new Date(), { day: "numeric", month: "long", year: "numeric" })}</Text>
          </View>
        </View>
        <View style={[s.row, { borderBottomColor: "#d0d5dd" }]}>
          {["Item", "Supplier code", "Qty", "Unit cost", "Total"].map((h, i) => (
            <Text key={h} style={[s.th, col[i]!]}>
              {h}
            </Text>
          ))}
        </View>
        {po.lines.map((l, i) => (
          <View key={i} style={s.row}>
            <Text style={col[0]}>{l.description}</Text>
            <Text style={col[1]}>{l.sku ?? ""}</Text>
            <Text style={col[2]}>{l.quantity}</Text>
            <Text style={col[3]}>{formatPence(l.unitCostPence)}</Text>
            <Text style={col[4]}>{formatPence(Math.round(l.quantity * l.unitCostPence))}</Text>
          </View>
        ))}
        <Text style={{ marginTop: 8, textAlign: "right", fontFamily: "Helvetica-Bold" }}>Total (ex VAT) {formatPence(total)}</Text>
        <View style={{ marginTop: 20 }}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>Deliver to</Text>
          <Text>{po.deliveryAddress}</Text>
          {po.expectedDate && <Text style={s.muted}>Required by {formatDate(po.expectedDate, { day: "numeric", month: "long", year: "numeric" })}</Text>}
          {po.notes && <Text style={{ marginTop: 8 }}>{po.notes}</Text>}
          <Text style={[s.muted, { marginTop: 12 }]}>Please confirm the order and delivery date by replying to the email this came with.</Text>
        </View>
      </Page>
    </Document>
  );
}

export function renderPoPdf(po: PoPdf) {
  return renderToBuffer(<Po po={po} />);
}
