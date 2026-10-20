/**
 * Paperwork per project (spec: Paperwork). Which items a project needs, when
 * they're due, and the values GoInstall can pre-fill for each. DNO items
 * follow the ENA standard forms; staff submit them through the DNO's portal
 * and record the reference here.
 */

export const PAPERWORK_KINDS = ["g99_application", "g98_notification", "ev_dno_notification", "mcs_certificate", "eic", "warranty_registration", "handover_pack"] as const;
export type PaperworkKind = (typeof PAPERWORK_KINDS)[number];

export const PAPERWORK_STATUSES = ["to_do", "submitted", "awaiting_response", "approved", "done"] as const;
export type PaperworkStatus = (typeof PAPERWORK_STATUSES)[number];
export const PAPERWORK_STATUS_LABELS: Record<PaperworkStatus, string> = { to_do: "To do", submitted: "Submitted", awaiting_response: "Awaiting response", approved: "Approved", done: "Done" };

export type PaperworkTiming = "before_install" | "after_install" | "after_commissioning" | "on_completion";
export const TIMING_LABELS: Record<PaperworkTiming, string> = { before_install: "Before install", after_install: "After install", after_commissioning: "After commissioning", on_completion: "On completion" };

export const PAPERWORK_TITLES: Record<PaperworkKind, string> = {
  g99_application: "G99 application to the DNO",
  g98_notification: "G98 notification to the DNO",
  ev_dno_notification: "EV charger notification to the DNO",
  mcs_certificate: "MCS certificate",
  eic: "Electrical installation certificate",
  warranty_registration: "Warranty registration",
  handover_pack: "Customer handover pack",
};

export interface PaperworkInput {
  /** Active solar/battery design, with its G98/G99 result (null when the inverter isn't chosen yet). */
  solar: { connectionForm: "G98" | "G99" | null } | null;
  /** Whether there's an active EV design. */
  ev: boolean;
  /** Whether the project has an install (booked or done). */
  hasInstall: boolean;
  /** Start of the install booking, and when the install was completed (commissioned). */
  installStart: Date | null;
  commissionedAt: Date | null;
  /** Products to register for warranty (from the designs). */
  warranties: { productId: string; name: string }[];
}

export interface PlannedItem {
  kind: PaperworkKind;
  productId: string | null;
  title: string;
  timing: PaperworkTiming;
  dueDate: string | null;
  dueNote: string | null;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/**
 * The paperwork a project needs, from its design and install. Due dates are
 * only set where a rule fixes them: G99 approval before the install starts;
 * G98 within 28 days of commissioning (ENA EREC G98). The rest are set by staff.
 */
export function paperworkFor(i: PaperworkInput): PlannedItem[] {
  const out: PlannedItem[] = [];
  const item = (kind: PaperworkKind, timing: PaperworkTiming, due: { date: string | null; note: string | null } = { date: null, note: null }, productId: string | null = null, title = PAPERWORK_TITLES[kind]) =>
    out.push({ kind, productId, title, timing, dueDate: due.date, dueNote: due.note });

  if (i.solar?.connectionForm === "G99") item("g99_application", "before_install", i.installStart ? { date: isoDate(i.installStart), note: "Approval needed before the install starts" } : { date: null, note: "Approval needed before the install starts" });
  else if (i.solar?.connectionForm === "G98") item("g98_notification", "after_commissioning", i.commissionedAt ? { date: isoDate(addDays(i.commissionedAt, 28)), note: "Within 28 days of commissioning (ENA G98)" } : { date: null, note: "Within 28 days of commissioning (ENA G98)" });
  if (i.ev) item("ev_dno_notification", "after_install");
  if (i.solar) item("mcs_certificate", "after_commissioning");
  if (i.hasInstall) item("eic", "after_install");
  for (const w of i.warranties) item("warranty_registration", "after_install", undefined, w.productId, `Warranty registration: ${w.name}`);
  if (i.hasInstall) item("handover_pack", "on_completion");
  return out;
}

/**
 * Valid MPAN core: 13 digits whose last is the check digit (the sum of the
 * first twelve times 3, 5, 7, 13, 17, 19, 23, 29, 31, 37, 41, 43, mod 11, mod 10).
 */
export function isValidMpanCore(mpan: string): boolean {
  const d = mpan.replace(/\s+/g, "");
  if (!/^\d{13}$/.test(d)) return false;
  const primes = [3, 5, 7, 13, 17, 19, 23, 29, 31, 37, 41, 43];
  const sum = primes.reduce((n, p, k) => n + p * Number(d[k]), 0);
  return (sum % 11) % 10 === Number(d[12]);
}

// ---------------------------------------------------------------------------
// Pre-filled values
// ---------------------------------------------------------------------------

export interface PaperworkContext {
  company: { name: string; address: string | null; phone: string | null; email: string | null; mcsNumber: string | null; competentPersonScheme: string | null };
  customer: { name: string; phone: string | null; email: string | null };
  site: { address: string; postcode: string | null; mpan: string | null };
  supply: { phases: 1 | 3 | null; mainFuseA: number | null; earthing: string | null };
  solar: {
    panel: { make: string | null; model: string; count: number } | null;
    kWp: number;
    inverter: { make: string | null; model: string; acKw: number | null; phases: number | null; enaRef: string | null } | null;
    battery: { make: string | null; model: string; usableKwh: number | null; powerKw: number | null; count: number; enaRef: string | null } | null;
    exportKw: number | null;
    annualKwh: number | null;
    mcsZone: string | null;
  } | null;
  ev: { make: string | null; model: string; ratedKw: number | null; ratedA: number | null; phases: number | null; enaRef: string | null; maxDemandA: number | null; loadManagement: boolean | null; cableMm2: number | null; protection: string | null } | null;
  installedAt: Date | null;
  commissionedAt: Date | null;
  /** Readings captured in the installer app, by checklist step. */
  readings: { step: string; product: string; values: { label: string; value: string; unit: string | null }[] }[];
  serials: { step: string; product: string; serial: string }[];
}

export interface FormValue {
  key: string;
  label: string;
  value: string | null;
  /** Where the value comes from, shown beside it. */
  source: string;
  /** Entered by staff on the item (GoInstall can't know it). */
  manual?: boolean;
  /** Not every job has one, so a blank isn't a gap. */
  optional?: boolean;
}

const made = (p: { make: string | null; model: string } | null) => (p ? [p.make, p.model].filter(Boolean).join(" ") : null);
const n = (v: number | null | undefined, unit: string) => (v == null ? null : `${v} ${unit}`);
const date = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null);

/** Values staff enter on DNO items, per kind. */
export const MANUAL_FIELDS: Partial<Record<PaperworkKind, { key: string; label: string; optional?: boolean }[]>> = {
  g98_notification: [{ key: "isolator_location", label: "Location of the lockable isolation switch" }, { key: "generator_location", label: "Location of the micro-generator in the installation" }],
  g99_application: [{ key: "isolator_location", label: "Location of the lockable isolation switch" }, { key: "export_limitation", label: "Export limitation scheme (if any)", optional: true }],
  ev_dno_notification: [{ key: "cut_out_photo", label: "Cut-out photo attached (yes/no)" }],
};

/**
 * The values GoInstall can pre-fill for an item, from company, survey,
 * design and install data. Unknown values are null and shown as gaps.
 */
export function paperworkValues(kind: PaperworkKind, c: PaperworkContext, manual: Record<string, string> = {}): FormValue[] {
  const v = (key: string, label: string, value: string | null, source: string): FormValue => ({ key, label, value, source });
  const installer = [
    v("installer_name", "Installer", c.company.name, "Company details"),
    v("installer_contact", "Installer contact", [c.company.phone, c.company.email].filter(Boolean).join(" · ") || null, "Company details"),
    v("installer_accreditation", "Installer accreditation (MCS)", c.company.mcsNumber, "Company details"),
  ];
  const customer = [
    v("customer_name", "Customer", c.customer.name, "Contact"),
    v("customer_contact", "Customer contact", [c.customer.phone, c.customer.email].filter(Boolean).join(" · ") || null, "Contact"),
    v("site_address", "Installation address", c.site.address || null, "Project"),
    v("site_postcode", "Postcode", c.site.postcode, "Project"),
    v("mpan", "MPAN", c.site.mpan, "Paperwork tab"),
  ];
  const s = c.solar;
  const generation = s
    ? [
        v("inverter", "Inverter (manufacturer and model)", made(s.inverter), "Solar design"),
        v("inverter_ena_ref", "Inverter: ENA type test register Product ID", s.inverter?.enaRef ?? null, "Product datasheet values"),
        v("registered_capacity", "Registered capacity", n(s.inverter?.acKw, "kW AC"), "Inverter datasheet"),
        v("phases", "Phases", s.inverter?.phases ? String(s.inverter.phases) : c.supply.phases ? String(c.supply.phases) : null, s.inverter?.phases ? "Inverter datasheet" : "Survey"),
        v("pv_array", "PV array", s.panel ? `${s.panel.count} × ${made(s.panel)}, ${s.kWp} kWp` : null, "Solar design"),
        ...(s.battery
          ? [
              v("battery", "Battery (manufacturer and model)", `${s.battery.count} × ${made(s.battery)}`, "Solar design"),
              v("battery_ena_ref", "Battery: ENA type test register Product ID", s.battery.enaRef, "Product datasheet values"),
              v("storage_kwh", "Energy storage capacity", n(s.battery.usableKwh == null ? null : Math.round(s.battery.usableKwh * s.battery.count * 10) / 10, "kWh"), "Battery datasheet"),
            ]
          : []),
        v("export_kw", "Export capacity", n(s.exportKw, "kW"), "Solar design"),
      ]
    : [];
  const dates = [v("installed_at", "Date of installation", date(c.installedAt), "Installer app"), v("commissioned_at", "Date of commissioning", date(c.commissionedAt), "Installer app")];
  const supply = [v("main_fuse", "Main fuse", n(c.supply.mainFuseA, "A"), "Survey / EV design"), v("earthing", "Earthing arrangement", c.supply.earthing, "Survey / EV design")];

  let values: FormValue[];
  switch (kind) {
    case "g98_notification":
      values = [...customer, ...installer, ...generation, ...dates];
      break;
    case "g99_application":
      values = [...customer, ...installer, ...generation, ...supply, v("planned_install", "Planned installation date", date(c.installedAt), "Install booking")];
      break;
    case "ev_dno_notification":
      values = [
        ...customer,
        ...installer,
        v("charger", "Charger (manufacturer and model)", made(c.ev), "EV design"),
        v("charger_ena_ref", "Charger: ENA type test register Product ID", c.ev?.enaRef ?? null, "Product datasheet values"),
        v("charger_rating", "Charger rating", c.ev ? [n(c.ev.ratedKw, "kW"), n(c.ev.ratedA, "A")].filter(Boolean).join(" / ") || null : null, "Charger datasheet"),
        v("charger_phases", "Charger phases", c.ev?.phases ? String(c.ev.phases) : null, "Charger datasheet"),
        ...supply,
        v("max_demand", "Maximum demand with the charger", n(c.ev?.maxDemandA, "A"), "EV design"),
        v("load_management", "Load management", c.ev?.loadManagement == null ? null : c.ev.loadManagement ? "Yes" : "No", "EV design"),
        dates[0]!,
      ];
      break;
    case "mcs_certificate":
      values = [
        ...customer.filter((x) => x.key !== "mpan"),
        ...installer,
        ...generation.filter((x) => !x.key.endsWith("ena_ref")),
        v("annual_kwh", "Estimated annual generation (MCS)", n(s?.annualKwh, "kWh"), "Solar design"),
        v("mcs_zone", "MCS postcode zone", s?.mcsZone ?? null, "Solar design"),
        dates[1]!,
        ...c.readings.filter((r) => r.product !== "ev").flatMap((r, k) => r.values.map((x, j) => v(`reading_${k}_${j}`, `${r.step}: ${x.label}`, x.value ? `${x.value}${x.unit ? ` ${x.unit}` : ""}` : null, "Installer app"))),
      ];
      break;
    case "eic":
      values = [
        ...customer.filter((x) => x.key !== "mpan"),
        ...installer.filter((x) => x.key !== "installer_accreditation"),
        v("competent_person_scheme", "Competent person scheme", c.company.competentPersonScheme, "Company details"),
        ...supply,
        dates[0]!,
        ...c.readings.flatMap((r, k) => r.values.map((x, j) => v(`reading_${k}_${j}`, `${r.step}: ${x.label}`, x.value ? `${x.value}${x.unit ? ` ${x.unit}` : ""}` : null, "Installer app"))),
      ];
      break;
    case "warranty_registration":
      values = [...customer.filter((x) => x.key !== "mpan"), ...installer, dates[0]!, ...c.serials.map((x, k) => v(`serial_${k}`, `${x.step}: serial`, x.serial, "Installer app"))];
      break;
    case "handover_pack":
      values = [...customer.filter((x) => x.key !== "mpan"), dates[1]!];
      break;
  }
  const extra = (MANUAL_FIELDS[kind] ?? []).map((f) => ({ key: f.key, label: f.label, value: manual[f.key]?.trim() || null, source: "Entered here", manual: true, optional: f.optional }));
  return [...values, ...extra];
}

/** Values still missing, by label: shown so staff can fill the gaps before submitting. */
export const missingValues = (values: FormValue[]) => values.filter((x) => !x.optional && (x.value === null || x.value === "")).map((x) => x.label);
