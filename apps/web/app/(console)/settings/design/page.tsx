import { DEFAULT_DESIGN_SETTINGS, DEFAULT_FINANCE, DESIGN_SETTING_FIELDS, FINANCE_FIELDS, RULE_TABLES, type FinanceAssumptions, type RuleTableKind } from "@goinstall/core";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { saveDesignSettingsAction, saveFinanceSettingsAction, uploadRuleTableAction } from "@/lib/actions/design-rules";
import { asUser } from "@/lib/auth";
import { loadDesignRules } from "@/lib/design-rules";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Design rules" };

export default async function DesignRulesPage() {
  const { rules, company } = await asUser(
    async (tx, s) => ({
      rules: await loadDesignRules(tx),
      company: await tx
        .selectFrom("companies")
        .select(["finance_settings", "default_unit_rate_pence", "default_standing_charge_pence", "default_export_rate_pence", "grid_emissions_kg_per_kwh", "grid_emissions_source"])
        .where("id", "=", s.companyId)
        .executeTakeFirstOrThrow(),
    }),
    ["admin"],
  );
  const finance = { ...DEFAULT_FINANCE, ...((company.finance_settings ?? {}) as Partial<FinanceAssumptions>) };
  return (
    <>
      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Rule tables</CardTitle>
          <p className="text-sm text-ink-3">
            Designs use your own copies of these tables. GoInstall doesn&apos;t supply MCS or cable values: upload them from the documents you work to. Each upload is a new
            version; designs saved earlier keep their figures.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {(Object.keys(RULE_TABLES) as RuleTableKind[]).map((kind) => {
            const v = rules.versions[kind];
            return (
              <section key={kind} aria-labelledby={`rt-${kind}`} className="flex flex-col gap-3 rounded-[10px] border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id={`rt-${kind}`} className="text-sm font-bold">
                    {RULE_TABLES[kind].label}
                  </h3>
                  {v ? (
                    <Badge variant="success">
                      Version {v.version} · {v.rows} rows · {formatDate(v.createdAt)}
                    </Badge>
                  ) : (
                    <Badge variant="warning">Not uploaded</Badge>
                  )}
                </div>
                {v && <p className="text-[13px] text-ink-3">Source: {v.sourceNote}</p>}
                <p className="text-[13px] text-muted-foreground">{RULE_TABLES[kind].help}</p>
                <ActionForm action={uploadRuleTableAction.bind(null, kind)} className="flex flex-wrap items-end gap-3" resetOnSuccess>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`rt-${kind}-file`} className="text-[13px] font-semibold text-ink-2">
                      CSV file
                    </label>
                    <Input id={`rt-${kind}-file`} name="file" type="file" accept=".csv,text/csv" required className="w-64 py-1.5" />
                  </div>
                  <div className="flex min-w-60 flex-1 flex-col gap-1.5">
                    <label htmlFor={`rt-${kind}-source`} className="text-[13px] font-semibold text-ink-2">
                      Source of the values
                    </label>
                    <Input id={`rt-${kind}-source`} name="source_note" required placeholder="e.g. MCS MIS 3002, the version you use" />
                  </div>
                  <SubmitButton size="sm" variant="outline" pendingText="Uploading…">
                    {v ? "Upload new version" : "Upload"}
                  </SubmitButton>
                </ActionForm>
              </section>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Design settings</CardTitle>
          <p className="text-sm text-ink-3">Every company starts with the defaults shown; change any to suit how you work. Leave a value blank and designs will say it&apos;s needed rather than assume one.</p>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveDesignSettingsAction} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {DESIGN_SETTING_FIELDS.map((f) => (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <label htmlFor={`ds-${f.key}`} className="text-[13px] font-semibold text-ink-2">
                    {f.label} ({f.unit})
                  </label>
                  <Input id={`ds-${f.key}`} name={f.key} inputMode="decimal" defaultValue={rules.settings[f.key] ?? ""} aria-describedby={`ds-${f.key}-help`} />
                  <span id={`ds-${f.key}-help`} className="text-xs text-muted-foreground">
                    {f.help} Default {DEFAULT_DESIGN_SETTINGS[f.key]} {f.unit}.
                  </span>
                </div>
              ))}
            </div>
            <div>
              <SubmitButton>Save design settings</SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Savings and payback</CardTitle>
          <p className="text-sm text-ink-3">
            Used for bills, payback, net present value and the 20-year cash flow on proposals. Prefilled with your own figures; change them to suit. Each project can
            have its own tariff on the Design tab.
          </p>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveFinanceSettingsAction} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FINANCE_FIELDS.map((f) => (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <label htmlFor={`fin-${f.key}`} className="text-[13px] font-semibold text-ink-2">
                    {f.label} ({f.unit})
                  </label>
                  <Input id={`fin-${f.key}`} name={f.key} inputMode="decimal" defaultValue={finance[f.key]} required aria-describedby={`fin-${f.key}-help`} />
                  <span id={`fin-${f.key}-help`} className="text-xs text-muted-foreground">
                    {f.help}
                  </span>
                </div>
              ))}
            </div>
            <h3 className="mt-2 text-sm font-bold">Default tariff for new projects</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  ["default_unit_rate_pence", "Unit rate (p/kWh)"],
                  ["default_standing_charge_pence", "Standing charge (p/day)"],
                  ["default_export_rate_pence", "Export tariff (p/kWh)"],
                ] as const
              ).map(([k, label]) => (
                <div key={k} className="flex flex-col gap-1.5">
                  <label htmlFor={k} className="text-[13px] font-semibold text-ink-2">
                    {label}
                  </label>
                  <Input id={k} name={k} inputMode="decimal" defaultValue={company[k] ?? ""} />
                </div>
              ))}
            </div>
            <h3 className="mt-2 text-sm font-bold">Environmental figures</h3>
            <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="grid_emissions_kg_per_kwh" className="text-[13px] font-semibold text-ink-2">
                  Grid emissions (kg CO₂ per kWh)
                </label>
                <Input id="grid_emissions_kg_per_kwh" name="grid_emissions_kg_per_kwh" inputMode="decimal" defaultValue={company.grid_emissions_kg_per_kwh ?? ""} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="grid_emissions_source" className="text-[13px] font-semibold text-ink-2">
                  Source of the factor
                </label>
                <Input id="grid_emissions_source" name="grid_emissions_source" defaultValue={company.grid_emissions_source ?? ""} placeholder="e.g. the published UK grid factor and year you use" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Leave the emissions factor blank to leave CO₂ off proposals.</p>
            <div>
              <SubmitButton>Save savings and payback</SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </>
  );
}
