import "server-only";
import { randomUUID } from "node:crypto";
import { paperworkValues, type PaperworkKind, type PaperworkTiming, type Specs } from "@goinstall/core";
import type { Tx } from "@goinstall/db";
import { PDFDocument } from "pdf-lib";
import type { Session } from "./auth";
import { aerialTile, fileStem, loadDesignDoc } from "./design-docs";
import { renderPlanPdf, renderSldPdf } from "./design-pdf";
import { fileStore } from "./files";
import { paperworkData } from "./paperwork";
import { renderHandoverCover, renderSheetPdf, SHEET_TITLES } from "./paperwork-pdf";

type Item = { id: string; project_id: string; kind: PaperworkKind; title: string; timing: string; fields: unknown; product_id: string | null };

async function company(tx: Tx, companyId: string) {
  const c = await tx.selectFrom("companies").select(["name", "brand_primary_colour", "phone", "email", "website"]).where("id", "=", companyId).executeTakeFirstOrThrow();
  return { ...c, brand: c.brand_primary_colour && /^#[0-9a-f]{6}$/i.test(c.brand_primary_colour) ? c.brand_primary_colour : "#0B7A62" };
}

/** Store a generated PDF against a paperwork item. */
async function storePdf(tx: Tx, session: Session, item: Item, bytes: Uint8Array, name: string) {
  const id = randomUUID();
  const path = `${session.companyId}/${item.project_id}/${id}.pdf`;
  await fileStore().put(path, bytes, "application/pdf");
  await tx
    .insertInto("files")
    .values({ id, project_id: item.project_id, kind: "document", path, content_type: "application/pdf", size_bytes: bytes.length, original_name: name.slice(0, 200), source: "generated", uploaded_by: session.userId, paperwork_item_id: item.id })
    .execute();
  return id;
}

/** The pre-filled details sheet for one item, saved to the item. */
export async function generateSheet(tx: Tx, session: Session, item: Item): Promise<string | null> {
  const data = await paperworkData(tx, session.companyId, item.project_id);
  if (!data) return null;
  const co = await company(tx, session.companyId);
  let ctx = data.context;
  // A warranty item covers its own product's serials.
  if (item.kind === "warranty_registration" && item.product_id) {
    const p = await tx.selectFrom("products").select(["category"]).where("id", "=", item.product_id).executeTakeFirst();
    const product = p?.category === "ev_charger" ? "ev" : p?.category === "battery" ? "battery" : "solar";
    ctx = { ...ctx, serials: ctx.serials.filter((x) => x.product === product) };
  }
  const values = paperworkValues(item.kind, ctx, (item.fields ?? {}) as Record<string, string>);
  const bytes = await renderSheetPdf({
    kind: item.kind,
    title: item.title,
    timing: item.timing as PaperworkTiming,
    companyName: co.name,
    brand: co.brand,
    customerName: ctx.customer.name,
    siteAddress: [ctx.site.address, ctx.site.postcode].filter(Boolean).join(", "),
    values,
    generatedAt: new Date(),
  });
  return storePdf(tx, session, item, new Uint8Array(bytes), `${fileStem(ctx.customer.name)}-${item.kind.replaceAll("_", "-")}.pdf`);
}

/**
 * The customer handover pack: a cover with the system and warranties, the
 * design plan and single line diagram, the uploaded certificates, and the
 * products' datasheets, merged into one PDF and saved to the item.
 */
export async function buildHandoverPack(tx: Tx, session: Session, item: Item): Promise<{ fileId: string; bytes: Uint8Array; missing: string[] } | null> {
  const data = await paperworkData(tx, session.companyId, item.project_id);
  if (!data) return null;
  const co = await company(tx, session.companyId);
  const c = data.context;
  const s = c.solar;
  const system: [string, string][] = [];
  if (s?.panel) system.push(["Solar panels", `${s.panel.count} × ${[s.panel.make, s.panel.model].filter(Boolean).join(" ")} (${s.kWp} kWp)`]);
  if (s?.inverter) system.push(["Inverter", [s.inverter.make, s.inverter.model].filter(Boolean).join(" ")]);
  if (s?.battery) system.push(["Battery", `${s.battery.count} × ${[s.battery.make, s.battery.model].filter(Boolean).join(" ")}`]);
  if (s?.annualKwh) system.push(["Estimated generation (MCS)", `${s.annualKwh.toLocaleString("en-GB")} kWh a year`]);
  if (c.ev) system.push(["EV charger", [c.ev.make, c.ev.model].filter(Boolean).join(" ")]);

  const parts: { name: string; bytes: Uint8Array; type: string }[] = [];
  const missing: string[] = [];
  const design = s ? await loadDesignDoc(tx, item.project_id) : null;
  if (design) {
    parts.push({ name: "System design", bytes: new Uint8Array(await renderPlanPdf(design, await aerialTile(design.position))), type: "application/pdf" });
    parts.push({ name: "Single line diagram", bytes: new Uint8Array(await renderSldPdf(design)), type: "application/pdf" });
  }
  // Certificates uploaded to their paperwork items (not GoInstall's own details sheets).
  const certs = await tx
    .selectFrom("paperwork_items as w")
    .innerJoin("files as f", "f.paperwork_item_id", "w.id")
    .select(["w.kind", "f.path", "f.content_type", "f.original_name", "f.created_at"])
    .where("w.project_id", "=", item.project_id)
    .where("w.kind", "in", ["eic", "mcs_certificate", "g98_notification", "g99_application", "ev_dno_notification"])
    .where("f.source", "!=", "generated")
    .where("f.deleted_at", "is", null)
    .orderBy("f.created_at")
    .execute();
  const certName: Record<string, string> = { eic: "Electrical installation certificate", mcs_certificate: "MCS certificate", g98_notification: "DNO notification", g99_application: "DNO approval", ev_dno_notification: "DNO notification (EV charger)" };
  for (const k of ["eic", "mcs_certificate"] as const) if (data.input.solar || k === "eic") if (!certs.some((x) => x.kind === k)) missing.push(certName[k]!);
  for (const f of certs) parts.push({ name: certName[f.kind] ?? f.original_name ?? "Certificate", bytes: await fileStore().get(f.path), type: f.content_type });
  const productIds = data.input.warranties.map((w) => w.productId);
  const sheets = productIds.length
    ? await tx.selectFrom("products as p").innerJoin("files as f", "f.id", "p.datasheet_file_id").select(["p.name", "f.path", "f.content_type"]).where("p.id", "in", productIds).where("f.deleted_at", "is", null).execute()
    : [];
  for (const d of sheets) parts.push({ name: `Datasheet: ${d.name}`, bytes: await fileStore().get(d.path), type: d.content_type });

  const specs = productIds.length ? await tx.selectFrom("products").select(["id", "name", "category", "specs"]).where("id", "in", productIds).execute() : [];
  const cover = await renderHandoverCover({
    companyName: co.name,
    brand: co.brand,
    companyContact: [co.phone, co.email, co.website].filter((v): v is string => Boolean(v)),
    customerName: c.customer.name,
    siteAddress: [c.site.address, c.site.postcode].filter(Boolean).join(", "),
    completedAt: c.commissionedAt,
    system,
    // The warranties page follows the cover, then the merged documents.
    contents: [...(specs.length ? ["Warranties"] : []), ...parts.map((p) => p.name)],
    warranties: specs.map((p) => {
      const product = p.category === "ev_charger" ? "ev" : p.category === "battery" ? "battery" : "solar";
      const years = (p.specs as Specs).warranty_years;
      return { name: p.name, serials: p.category === "panel" ? [] : c.serials.filter((x) => x.product === product).map((x) => x.serial), years: typeof years === "number" ? years : null };
    }),
  });

  const pack = await PDFDocument.create();
  pack.setTitle(`Handover pack, ${c.customer.name}`);
  pack.setAuthor(co.name);
  for (const part of [{ name: "Cover", bytes: new Uint8Array(cover), type: "application/pdf" }, ...parts]) {
    if (part.type === "application/pdf") {
      const src = await PDFDocument.load(part.bytes, { ignoreEncryption: true }).catch(() => null);
      if (!src) {
        missing.push(`${part.name} (couldn't be read)`);
        continue;
      }
      for (const page of await pack.copyPages(src, src.getPageIndices())) pack.addPage(page);
    } else if (part.type === "image/png" || part.type === "image/jpeg") {
      // A photographed certificate: one image per A4 page, fitted.
      const img = part.type === "image/png" ? await pack.embedPng(part.bytes) : await pack.embedJpg(part.bytes);
      const page = pack.addPage([595.28, 841.89]);
      const scale = Math.min(515 / img.width, 761 / img.height, 1);
      page.drawImage(img, { x: (595.28 - img.width * scale) / 2, y: (841.89 - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
    }
  }
  const bytes = await pack.save();
  const fileId = await storePdf(tx, session, item, bytes, `${fileStem(c.customer.name)}-handover-pack.pdf`);
  return { fileId, bytes, missing };
}

export { SHEET_TITLES };
