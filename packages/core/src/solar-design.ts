/**
 * Evaluate a whole solar design: the single function the designer (live) and
 * the server (on save) both call, so the figures shown are the figures stored.
 */
import type { DesignSettings } from "./rules";
import {
  connectionApplication,
  dcAcRatio,
  exportCapacityKw,
  kWp as toKwp,
  layoutStrings,
  mcsAnnualGeneration,
  selfConsumption,
  stringLimits,
  type InverterSpecs,
  type McsYieldRow,
  type McsZoneRow,
  type PanelSpecs,
  type SelfConsumptionRow,
} from "./solar";

export interface DesignArray {
  id: string;
  label: string;
  pitch: number;
  azimuth: number;
  panelCount: number;
  shadeFactor: number;
}

export interface SolarDesignInput {
  arrays: DesignArray[];
  panel: { specs: PanelSpecs } | null;
  inverter: { specs: InverterSpecs } | null;
  battery: { usableKwh: number; count: number } | null;
  postcode: string;
  phases: 1 | 3;
  exportLimitKw?: number | null;
  survey: { occupancy: string | null; annualUsageKwh: number | null };
  hasEv: boolean;
  rules: { yields: McsYieldRow[] | null; zones: McsZoneRow[] | null; selfConsumption: SelfConsumptionRow[] | null; settings: DesignSettings };
}

export interface SolarDesignResult {
  panelCount: number;
  kWp: number;
  annualKwh: number | null;
  perArray: { id: string; label: string; panels: number; kWp: number; pitch: number; azimuth: number; shadeFactor: number; kwhPerKwp: number | null; annualKwh: number | null }[];
  strings: number[] | null;
  dcAc: number | null;
  exportKw: number | null;
  connection: { form: "G98" | "G99"; thresholdKw: number } | null;
  selfUse: number | null;
  selfUseWithBattery: number | null;
  yearlySavingPence: number | null;
  evMiles: number | null;
  /** Why a figure is missing: shown to staff in place of a guess. */
  notes: string[];
}

export function evaluateSolarDesign(input: SolarDesignInput): SolarDesignResult {
  const notes: string[] = [];
  const arrays = input.arrays.filter((a) => a.panelCount > 0);
  const panelCount = arrays.reduce((n, a) => n + a.panelCount, 0);
  const wp = input.panel?.specs.watts_peak ?? 0;
  if (!input.panel) notes.push("Choose a panel.");
  else if (!wp) notes.push("The chosen panel has no peak power (Wp) in its datasheet values.");
  const kWp = wp ? toKwp(panelCount, wp) : 0;

  let annualKwh: number | null = null;
  let perArray: SolarDesignResult["perArray"] = arrays.map((a) => ({ id: a.id, label: a.label, panels: a.panelCount, kWp: wp ? toKwp(a.panelCount, wp) : 0, pitch: a.pitch, azimuth: a.azimuth, shadeFactor: a.shadeFactor, kwhPerKwp: null, annualKwh: null }));
  if (panelCount && wp) {
    const mcs = mcsAnnualGeneration(arrays, wp, input.postcode, input.rules.yields && input.rules.zones ? { yields: input.rules.yields, zones: input.rules.zones } : null);
    if (mcs.ok) {
      annualKwh = mcs.annualKwh;
      perArray = perArray.map((p) => {
        const y = mcs.arrays.find((m) => m.id === p.id);
        return y ? { ...p, kwhPerKwp: y.kwhPerKwp, annualKwh: y.annualKwh } : p;
      });
    } else notes.push(mcs.missing);
  }

  let strings: number[] | null = null;
  let dcAc: number | null = null;
  let exportKw: number | null = null;
  let connection: SolarDesignResult["connection"] = null;
  if (input.inverter) {
    const ac = input.inverter.specs.ac_kw ?? 0;
    if (!ac) notes.push("The chosen inverter has no AC output in its datasheet values.");
    else {
      dcAc = kWp ? dcAcRatio(kWp, ac) : null;
      exportKw = exportCapacityKw([{ acKw: ac }], input.exportLimitKw);
      connection = connectionApplication(exportKw, input.phases, { limitAPerPhase: input.rules.settings.g98LimitAPerPhase });
      if (input.inverter.specs.max_dc_kw && kWp > input.inverter.specs.max_dc_kw) notes.push(`The array (${kWp} kWp) is above the inverter's ${input.inverter.specs.max_dc_kw} kW maximum DC input.`);
    }
    if (input.panel && panelCount) {
      const limits = stringLimits(input.panel.specs, input.inverter.specs, { minDesignTempC: input.rules.settings.minDesignTempC });
      if (!limits.ok) notes.push(limits.missing);
      else {
        if (!limits.vocCorrected) notes.push("Strings use uncorrected Voc: set the minimum design temperature and the panel's Voc temperature coefficient.");
        const layout = layoutStrings(panelCount, limits, input.inverter.specs.mppt_count ?? 1);
        if (layout.ok) strings = layout.strings;
        else notes.push(layout.missing);
      }
    }
  } else if (panelCount) notes.push("Choose an inverter.");

  let selfUse: number | null = null;
  let selfUseWithBattery: number | null = null;
  if (annualKwh) {
    const base = { occupancy: input.survey.occupancy, consumptionKwh: input.survey.annualUsageKwh, generationKwh: annualKwh };
    const without = selfConsumption(input.rules.selfConsumption, { ...base, batteryKwh: 0 });
    if (without.ok) selfUse = without.fraction;
    else notes.push(without.missing);
    if (input.battery?.count) {
      const withB = selfConsumption(input.rules.selfConsumption, { ...base, batteryKwh: input.battery.usableKwh * input.battery.count });
      if (withB.ok) selfUseWithBattery = withB.fraction;
    }
  }

  let yearlySavingPence: number | null = null;
  const used = selfUseWithBattery ?? selfUse;
  const { importPencePerKwh, exportPencePerKwh, evMilesPerKwh } = input.rules.settings;
  if (annualKwh && used !== null) {
    if (importPencePerKwh == null || exportPencePerKwh == null) notes.push("Set the electricity price and export rate in Settings › Design rules for the yearly saving.");
    else yearlySavingPence = Math.round(annualKwh * (used * importPencePerKwh + (1 - used) * exportPencePerKwh));
  }

  let evMiles: number | null = null;
  if (input.hasEv && annualKwh && used !== null) {
    if (evMilesPerKwh == null) notes.push("Set EV efficiency (miles per kWh) in Settings › Design rules for EV miles from solar.");
    else evMiles = Math.round((annualKwh * (1 - used) * evMilesPerKwh) / 100) * 100;
  }

  return { panelCount, kWp, annualKwh, perArray, strings, dcAc, exportKw, connection, selfUse, selfUseWithBattery, yearlySavingPence, evMiles, notes: [...new Set(notes)] };
}
