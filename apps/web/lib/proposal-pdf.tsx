import "server-only";
import { customerLines, formatPence, paybackLabel, paybackYears, proposalReference, proposalTotals, SECTION_LABELS, type ProposalSection } from "@goinstall/core";
import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { initials, type ProposalPageView, type ProposalView } from "@/components/proposal-document";
import { ProposalPdfSections } from "./proposal-pdf-sections";
import { proposalViewWithLayout, type ProposalContent } from "./proposals";
import { fileStore } from "./files";
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

/** An image read from storage (react-pdf draws JPEG and PNG only). */
type PdfImage = { data: Buffer; format: "png" | "jpg" };

async function loadImage(path: string | null | undefined): Promise<PdfImage | null> {
  const format = path?.match(/\.(png|jpe?g)$/i)?.[1]?.toLowerCase();
  if (!path || !format) return null;
  try {
    return { data: Buffer.from(await fileStore().get(path)), format: format === "png" ? "png" : "jpg" };
  } catch {
    return null;
  }
}

export interface PdfExtras {
  brandColour: string | null;
  contact: string[];
  bank: { name: string | null; sortCode: string | null; account: string | null };
  paymentTerms: string | null;
  acceptance: { name: string; at: Date } | null;
  /** The logo and product photos, read from storage. */
  logo?: PdfImage | null;
  photos?: Map<string, PdfImage>;
  /** Template images: the cover, and "<page id>:work:<n>" / "<page id>:acc:<n>". */
  cover?: PdfImage | null;
  pageImages?: Map<string, PdfImage>;
}

/** A template page (reviews, featured work, accreditations or a custom page). */
function TemplatePdfPage({ pg, s, images }: { pg: ProposalPageView; s: ReturnType<typeof styles>; images?: Map<string, PdfImage> }) {
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={s.section}>{pg.title.toUpperCase()}</Text>
      {pg.intro && pg.type !== "text" && <Text style={[s.muted, { marginBottom: 4 }]}>{pg.intro}</Text>}
      {pg.type === "text" && pg.intro && <Text style={{ lineHeight: 1.4, marginTop: 4 }}>{pg.intro}</Text>}
      {pg.type === "reviews" && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          {pg.reviews.map((r, i) => (
            <View key={i} style={{ width: "48%", backgroundColor: "#f9fafb", borderRadius: 6, padding: 9 }} wrap={false}>
              {r.rating && <Text style={[s.bold, { color: "#B54708", marginBottom: 3 }]}>{`${r.rating} out of 5 stars`}</Text>}
              {r.text && <Text style={{ lineHeight: 1.4 }}>{`"${r.text}"`}</Text>}
              <Text style={[s.muted, { marginTop: 4 }]}>{[r.name, r.location].filter(Boolean).join(", ")}</Text>
            </View>
          ))}
        </View>
      )}
      {pg.type === "reviews" && pg.link && <Text style={[s.muted, { marginTop: 6 }]}>More reviews: {pg.link}</Text>}
      {pg.type === "featured_work" && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 }}>
          {pg.work.map((w, i) => {
            const im = images?.get(`${pg.id}:work:${i}`);
            return (
              <View key={i} style={{ width: "48%" }} wrap={false}>
                {im && <Image src={im} style={{ width: "100%", height: 130, objectFit: "cover", borderRadius: 6 }} />}
                <Text style={[s.bold, { marginTop: 4 }]}>{w.title}</Text>
                {w.description && <Text style={s.muted}>{w.description}</Text>}
              </View>
            );
          })}
        </View>
      )}
      {pg.type === "accreditations" && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 }}>
          {pg.accreditations.map((a, i) => {
            const im = images?.get(`${pg.id}:acc:${i}`);
            return (
              <View key={i} style={{ width: "31%", alignItems: "center", borderWidth: 1, borderColor: LINE, borderRadius: 6, padding: 8 }} wrap={false}>
                {im && <Image src={im} style={{ height: 40, maxWidth: 120, objectFit: "contain", marginBottom: 4 }} />}
                <Text style={s.bold}>{a.name}</Text>
                {a.number && <Text style={s.muted}>{a.number}</Text>}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

/** The front cover: a full page with the photo, the headline and who it's for. */
function CoverPdfPage({ p, x, brand, reference }: { p: ProposalView; x: PdfExtras; brand: string; reference: string }) {
  const c = p.cover!;
  return (
    <Page size="A4" style={{ fontFamily: "Helvetica", color: INK }}>
      {x.cover ? <Image src={x.cover} style={{ width: "100%", height: 470, objectFit: "cover" }} /> : <View style={{ width: "100%", height: 470, backgroundColor: brand }} />}
      <View style={{ padding: 48, flex: 1 }}>
        {x.logo ? <Image src={x.logo} style={{ height: 44, maxWidth: 180, objectFit: "contain", marginBottom: 24 }} /> : <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 14, marginBottom: 24 }}>{p.companyName}</Text>}
        <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 26, lineHeight: 1.2 }}>{c.headline}</Text>
        {c.subheading && <Text style={{ fontSize: 13, color: INK3, marginTop: 8, lineHeight: 1.4 }}>{c.subheading}</Text>}
        <View style={{ marginTop: "auto", flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: LINE, paddingTop: 12 }}>
          <View>
            <Text style={{ color: INK3, fontSize: 9 }}>Prepared for</Text>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11 }}>{p.contactName}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ color: INK3, fontSize: 9 }}>Proposal {reference}</Text>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11 }}>{p.companyName}</Text>
          </View>
        </View>
      </View>
    </Page>
  );
}

function ProposalPdf({ p, x }: { p: ProposalView; x: PdfExtras }) {
  const brand = x.brandColour && /^#[0-9a-f]{6}$/i.test(x.brandColour) ? x.brandColour : "#0B7A62";
  const s = styles(brand);
  const t = proposalTotals(p.lines, p.depositPct);
  const fin = p.summary.finance;
  const saving = fin ? fin.firstYear.totals.savingPence : (p.summary.yearlySavingPence ?? null);
  const payback = fin ? (fin.cashFlow.discountedPaybackYears === null ? null : paybackLabel(fin.cashFlow.discountedPaybackYears)) : paybackYears(t.totalPence, saving) ? `${paybackYears(t.totalPence, saving)} years` : null;
  const tiles = [
    p.summary.kWp ? ["System size", `${Number(p.summary.kWp).toFixed(2)} kWp`] : null,
    p.summary.annualKwh ? ["Generation", `${Math.round(p.summary.annualKwh).toLocaleString("en-GB")} kWh a year`] : null,
    saving ? ["Yearly saving", formatPence(Math.round(saving / 100) * 100)] : null,
    payback ? ["Payback", payback] : null,
  ].filter((r): r is string[] => Boolean(r));
  const ref = proposalReference(p.documentPrefix, p.number, p.version);
  const footer = (
    <View style={s.footer} fixed>
      <Text>{x.contact.join(" · ")}</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
  const quote = (
    <>
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
          const lines = customerLines(p.lines).filter((l) => l.section === sec);
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
                    <Text style={l.display === "hide_price" ? s.muted : undefined}>{l.display === "hide_price" ? "Included" : total < 0 ? `-${formatPence(-total)}` : formatPence(total)}</Text>
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
        {p.products && p.products.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={s.section}>THE PRODUCTS</Text>
            {p.products.map((prod) => (
              <View key={prod.id} style={[s.line, { justifyContent: "flex-start", gap: 10, alignItems: "center" }]} wrap={false}>
                {/* react-pdf draws JPEG and PNG only; WebP photos show on the web page. */}
                {x.photos?.get(prod.id) && <Image src={x.photos.get(prod.id)!} style={{ width: 54, height: 54, objectFit: "contain" }} />}
                <View style={{ flex: 1 }}>
                  <Text style={s.bold}>{prod.name}</Text>
                  {prod.makeModel && <Text style={s.muted}>{prod.makeModel}</Text>}
                  {prod.datasheetUrl && <Text style={s.muted}>Datasheet on your proposal page.</Text>}
                </View>
              </View>
            ))}
          </View>
        )}
        {p.survey && p.survey.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={s.section}>YOUR SURVEY</Text>
            {p.survey.map((sec) => (
              <View key={sec.key} style={{ flexDirection: "row", gap: 12, borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 7 }} wrap={false}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.bold, { marginBottom: 3 }]}>{sec.title}</Text>
                  {sec.items.map((it) => (
                    <View key={it.label} style={{ flexDirection: "row", gap: 6, marginBottom: 1 }}>
                      <Text style={[s.muted, { width: "50%" }]}>{it.label}</Text>
                      <Text style={{ width: "50%" }}>{it.value}</Text>
                    </View>
                  ))}
                </View>
                <View style={{ flex: 1, backgroundColor: "#f9fafb", borderRadius: 5, padding: 7 }}>
                  <Text style={[s.muted, { fontSize: 7, fontFamily: "Helvetica-Bold", marginBottom: 2 }]}>OUR NOTES</Text>
                  <Text style={{ lineHeight: 1.4 }}>{sec.note ?? "-"}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
    </>
  );
  const about = p.about && (p.about.text || p.about.facts.length > 0) ? (

          <View style={{ marginTop: 16 }} wrap={false}>
            <Text style={s.section}>ABOUT {p.companyName.toUpperCase()}</Text>
            <View style={{ flexDirection: "row", gap: 14, marginTop: 4 }}>
              <View style={{ flex: 2 }}>{p.about.text && <Text style={{ lineHeight: 1.4 }}>{p.about.text}</Text>}</View>
              <View style={{ flex: 1 }}>
                {[...p.about.facts, ...p.about.contact].map((f) => (
                  <Text key={f} style={[s.muted, { marginBottom: 2 }]}>
                    {f}
                  </Text>
                ))}
              </View>
            </View>
          </View>
  ) : null;
  return (
    <Document title={`${p.companyName} proposal ${ref}`} author={p.companyName}>
      {p.cover && <CoverPdfPage p={p} x={x} brand={brand} reference={ref} />}
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {x.logo ? <Image src={x.logo} style={{ height: 34, maxWidth: 140, objectFit: "contain" }} /> : <Text style={s.logo}>{initials(p.companyName)}</Text>}
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
        {(p.pages ?? [{ type: "quote" }, { type: "about" }]).map((pg, i) => {
          if (pg.type === "quote") return <View key={`q${i}`}>{quote}</View>;
          if (pg.type === "about") return <View key={`a${i}`}>{about}</View>;
          return <TemplatePdfPage key={`t${i}`} pg={pg as ProposalPageView} s={s} images={x.pageImages} />;
        })}
        {(p.terms || p.termsFile) && (
          <View style={s.terms}>
            <Text style={[s.bold, { color: INK, marginBottom: 4 }]}>Terms and conditions</Text>
            {p.termsFile && <Text style={{ marginBottom: 4 }}>Our full terms and conditions are in the separate PDF sent with this proposal and linked on your proposal page.</Text>}
            {p.terms && <Text>{p.terms}</Text>}
          </View>
        )}
        {footer}
      </Page>
      <ProposalPdfSections sm={p.summary} layoutSrc={p.layoutUrl ?? null} footer={footer} />
    </Document>
  );
}

export function renderProposalPdf(p: ProposalView, x: PdfExtras) {
  return renderToBuffer(<ProposalPdf p={p} x={x} />);
}

/** The PDF for a loaded proposal as a download response. */
export async function proposalPdfResponse(c: ProposalContent) {
  const p = c.proposal;
  // Template images by place, read from storage (JPEG and PNG, as uploaded in Settings).
  const tPath = (id: string | null) => (id ? (c.templateFiles.find((f) => f.id === id)?.path ?? null) : null);
  const pageImages = new Map<string, PdfImage>();
  for (const pg of c.template.pages) {
    for (const [i, w] of pg.work.entries()) {
      const im = await loadImage(tPath(w.photoFileId));
      if (im) pageImages.set(`${pg.id}:work:${i}`, im);
    }
    for (const [i, a] of pg.accreditations.entries()) {
      const im = await loadImage(tPath(a.logoFileId));
      if (im) pageImages.set(`${pg.id}:acc:${i}`, im);
    }
  }
  const buf = await renderProposalPdf(await proposalViewWithLayout(c), {
    cover: await loadImage(tPath(c.template.cover.imageFileId)),
    pageImages,
    brandColour: p.brand_primary_colour,
    contact: [p.company_phone, p.company_email, p.company_website].filter((v): v is string => Boolean(v)),
    bank: { name: p.bank_account_name, sortCode: p.bank_sort_code, account: p.bank_account_number },
    paymentTerms: p.payment_terms,
    acceptance: p.accepted_at && p.accepted_name ? { name: p.accepted_name, at: p.accepted_at } : null,
    logo: await loadImage(p.company_logo_path),
    photos: new Map((await Promise.all(c.products.map(async (x) => [x.id, await loadImage(x.photo_path)] as const))).filter((e): e is [string, PdfImage] => e[1] !== null)),
  });
  const name = `${proposalReference(p.document_prefix, p.number)}-v${p.version}.pdf`;
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" },
  });
}
