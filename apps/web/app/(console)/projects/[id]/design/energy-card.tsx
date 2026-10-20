import { firstYear, formatPence, MONTHS } from "@goinstall/core";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { saveEnergyProfileAction } from "@/lib/actions/energy";
import type { ProjectEnergy } from "@/lib/energy";

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Design tab: the customer's use and tariff, and the first-year bills they lead to. */
export function EnergyCard({
  projectId,
  energy: e,
  design,
}: {
  projectId: string;
  energy: ProjectEnergy;
  design: { annual_kwh_mcs: number | null; pvgis_monthly: number[] | null; self_consumption: string | null; self_consumption_with_battery: string | null } | null;
}) {
  const sc = design ? Number(design.self_consumption_with_battery ?? design.self_consumption ?? NaN) : NaN;
  const fy =
    design?.annual_kwh_mcs && e.consumption && e.tariff && Number.isFinite(sc)
      ? firstYear({ annualGenerationKwh: design.annual_kwh_mcs, generationShape: design.pvgis_monthly, consumption: e.consumption, selfConsumption: sc, tariff: e.tariff })
      : null;
  const val = (n: number | null) => (n === null ? "" : String(n));
  return (
    <Card>
      <CardHeader className="flex-col items-start">
        <CardTitle>Energy use and tariff</CardTitle>
        <p className="text-sm text-ink-3">
          From the customer&apos;s bills. Used for self-consumption, bills before and after, payback and the 20-year figures on the proposal.
          {!e.saved && e.annualKwh ? " Annual use is from the survey; tariff from your defaults." : ""}
        </p>
      </CardHeader>
      <CardContent className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <ActionForm action={saveEnergyProfileAction.bind(null, projectId)} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Annual use (kWh)" htmlFor="annual">
              <Input id="annual" name="annual" inputMode="numeric" defaultValue={e.monthlyKwh ? "" : val(e.annualKwh)} placeholder={e.monthlyKwh ? "From the months" : "e.g. 4200"} />
            </Field>
            <Field label="Figures from" htmlFor="source">
              <Select id="source" name="source" defaultValue={e.source}>
                <option value="bills">Bills</option>
                <option value="survey">Survey</option>
                <option value="estimate">Estimate</option>
              </Select>
            </Field>
            <Field label="Tariff name (optional)" htmlFor="tariff_name">
              <Input id="tariff_name" name="tariff_name" defaultValue={e.tariffName ?? ""} placeholder="e.g. Octopus Flexible" />
            </Field>
          </div>
          <details open={Boolean(e.monthlyKwh)} className="rounded-[10px] border p-3">
            <summary className="cursor-pointer text-sm font-semibold">Monthly use (kWh), for a more accurate month-by-month picture</summary>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {MONTHS.map((m, i) => (
                <Field key={m} label={m} htmlFor={`m_${m}`}>
                  <Input id={`m_${m}`} name={`m_${m.toLowerCase()}`} inputMode="numeric" defaultValue={e.monthlyKwh ? String(e.monthlyKwh[i]) : ""} />
                </Field>
              ))}
            </div>
          </details>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Unit rate (p/kWh)" htmlFor="unit">
              <Input id="unit" name="unit" inputMode="decimal" defaultValue={val(e.unitRatePence)} />
            </Field>
            <Field label="Standing charge (p/day)" htmlFor="standing">
              <Input id="standing" name="standing" inputMode="decimal" defaultValue={val(e.standingChargePencePerDay)} />
            </Field>
            <Field label="Export tariff (p/kWh)" htmlFor="export">
              <Input id="export" name="export" inputMode="decimal" defaultValue={val(e.exportRatePence)} />
            </Field>
          </div>
          <div>
            <SubmitButton variant="outline">Save energy use and tariff</SubmitButton>
          </div>
        </ActionForm>
        <section aria-labelledby="bills-title" className="flex flex-col gap-3 rounded-[10px] bg-surface-subtle p-4">
          <h3 id="bills-title" className="text-sm font-bold">
            First year
          </h3>
          {fy ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm" data-testid="first-year">
              <dt className="text-ink-3">Bill before</dt>
              <dd className="text-right font-semibold">{formatPence(fy.totals.billBeforePence)}</dd>
              <dt className="text-ink-3">Bill after</dt>
              <dd className="text-right font-semibold text-primary">{formatPence(fy.totals.billAfterPence)}</dd>
              <dt className="text-ink-3">Saving</dt>
              <dd className="text-right font-semibold">
                {formatPence(fy.totals.savingPence)} · {pct(fy.totals.savingPct)}
              </dd>
              <dt className="text-ink-3">Used at home</dt>
              <dd className="text-right">{pct(fy.totals.selfConsumption)}</dd>
              <dt className="text-ink-3">Home use met by solar</dt>
              <dd className="text-right">{pct(fy.totals.selfSufficiency)}</dd>
            </dl>
          ) : (
            <p className="text-sm text-ink-3">
              {e.missing.length ? `Add ${e.missing.join(", ")} to see the bills.` : !design?.annual_kwh_mcs ? "Save a design with an MCS figure to see the bills." : "The design needs a self-consumption figure (MCS tables in Settings › Design rules)."}
            </p>
          )}
          {fy && !design?.pvgis_monthly && <p className="text-xs text-muted-foreground">Months follow days in the month until the PVGIS cross-check runs (set PVGIS losses in Design rules).</p>}
          <p className="text-xs text-muted-foreground">Payback and the 20-year figures appear on the proposal, once its price is set.</p>
        </section>
      </CardContent>
    </Card>
  );
}
