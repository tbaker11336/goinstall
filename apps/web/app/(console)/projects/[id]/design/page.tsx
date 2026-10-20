import { inStock } from "@goinstall/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { buttonVariants } from "@/components/ui/button";
import type { SolarDesignPayload } from "@/lib/actions/design";
import { asUser } from "@/lib/auth";
import { listCatalogue, type CatalogueProduct } from "@/lib/catalogue";
import { loadDesignRules } from "@/lib/design-rules";
import { loadEnergy } from "@/lib/energy";
import { signedUrls } from "@/lib/files";
import {
  aerialWidthM,
  ensureSitePosition,
  roofData,
  segmentsFromInsights,
} from "@/lib/site";
import { surveyAnswers, surveyPhotos } from "@/lib/survey";
import { cn } from "@/lib/utils";
import { EnergyCard } from "./energy-card";
import { EvDesigner } from "./ev-designer";
import { loadEvDesign } from "./ev-data";
import { SolarDesigner, type CatalogueOption } from "./solar-designer";

export const metadata = { title: "Design" };

const option = (p: CatalogueProduct): CatalogueOption => ({
  id: p.id,
  name: p.name,
  specs: p.specs,
  sellPence: p.sellPence,
  best: p.best
    ? {
        supplierName: p.best.supplierName,
        costPence: p.best.costPence,
        inStock: inStock(p.best),
      }
    : null,
});

export default async function DesignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const { view: viewParam } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();

  const data = await asUser(async (tx) => {
    const project = await tx
      .selectFrom("projects")
      .select([
        "id",
        "products",
        "lat",
        "lng",
        "site_address_line1",
        "site_town",
        "site_postcode",
      ])
      .where("id", "=", id)
      .executeTakeFirst();
    if (!project) return null;
    const position = await ensureSitePosition(tx, project);
    const [rules, catalogue, answers, photos, design] = await Promise.all([
      loadDesignRules(tx),
      listCatalogue(tx, {
        categories: ["panel", "inverter", "battery", "ev_charger"],
      }),
      surveyAnswers(tx, id),
      surveyPhotos(tx, id),
      tx
        .selectFrom("solar_designs")
        .selectAll()
        .where("project_id", "=", id)
        .where("is_active", "=", true)
        .executeTakeFirst(),
    ]);
    const hasSolar =
      project.products.includes("solar") ||
      project.products.includes("battery");
    const hasEv = project.products.includes("ev");
    const view: "solar" | "ev" =
      viewParam === "ev" && hasEv ? "ev" : hasSolar || !hasEv ? "solar" : "ev";
    const roof =
      hasSolar && view === "solar" && !design
        ? await roofData(tx, id, position)
        : null;
    const ev = view === "ev" ? await loadEvDesign(tx, id) : null;
    const evSaved = Boolean(
      await tx
        .selectFrom("ev_designs")
        .select("id")
        .where("project_id", "=", id)
        .where("is_active", "=", true)
        .executeTakeFirst(),
    );
    const energy = await loadEnergy(tx, id);
    return {
      energy,
      project,
      position,
      rules,
      catalogue,
      answers,
      photos,
      design,
      roof,
      view,
      hasSolar,
      hasEv,
      ev,
      evSaved,
    };
  });
  if (!data) notFound();
  const {
    project,
    position,
    rules,
    catalogue,
    answers,
    design,
    roof,
    view,
    hasSolar,
    hasEv,
  } = data;

  const urls = await signedUrls(data.photos.slice(0, 18).map((p) => p.path));
  const photos = data.photos
    .slice(0, 18)
    .flatMap((p) =>
      urls.get(p.path)
        ? [
            {
              url: urls.get(p.path)!,
              label: p.category?.replaceAll("_", " ") ?? "Photo",
            },
          ]
        : [],
    );
  const aerial =
    position && process.env.GOOGLE_MAPS_API_KEY
      ? { url: `/api/maps/aerial/${id}`, widthM: aerialWidthM(position.lat) }
      : null;
  const byCat = (c: CatalogueProduct["category"]) =>
    catalogue.filter((p) => p.category === c).map(option);
  const occupancy = answers.occupancy ?? null;
  // Energy use entered below wins over the survey answer.
  const usage = data.energy.annualKwh;
  const phases: 1 | 3 = /three/i.test(answers.supply_phase ?? "") ? 3 : 1;

  const initial: SolarDesignPayload & {
    version: number | null;
    savedAt: string | null;
  } = design
    ? {
        roofSource: design.roof_source as "google_solar" | "drawn",
        segments: design.segments as SolarDesignPayload["segments"],
        panelProductId: design.panel_product_id,
        inverterProductId: design.inverter_product_id,
        batteryProductId: design.battery_product_id,
        batteryCount: design.battery_count,
        version: design.version,
        savedAt: design.created_at.toISOString(),
      }
    : {
        roofSource: roof?.insights ? "google_solar" : "drawn",
        segments:
          roof?.insights && position
            ? segmentsFromInsights(roof.insights, position)
            : [],
        panelProductId: null,
        inverterProductId: null,
        batteryProductId: project.products.includes("battery")
          ? (byCat("battery")[0]?.id ?? null)
          : null,
        batteryCount: 1,
        version: null,
        savedAt: null,
      };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {hasSolar && hasEv ? (
          <nav
            aria-label="Design view"
            className="flex w-fit rounded-[9px] bg-divider p-[3px]"
          >
            {(["solar", "ev"] as const).map((v) => (
              <Link
                key={v}
                href={`/projects/${id}/design${v === "ev" ? "?view=ev" : ""}`}
                aria-current={view === v ? "page" : undefined}
                className={cn(
                  "rounded-[7px] px-4 py-2 text-sm font-semibold text-ink-3 hover:text-foreground",
                  view === v &&
                    "bg-card text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.1)]",
                )}
              >
                {v === "solar" ? "Solar PV" : "EV charger"}
              </Link>
            ))}
          </nav>
        ) : (
          <span />
        )}
        {(design || data.evSaved) && (
          <Link
            href={`/projects/${id}/proposal`}
            className={buttonVariants({ variant: "outline" })}
          >
            Create proposal
          </Link>
        )}
      </div>
      {view === "solar" ? (
        <SolarDesigner
          key={design?.version ?? 0}
          projectId={id}
          initial={initial}
          saved={
            design
              ? {
                  pvgisKwh: design.pvgis_kwh,
                  pvgisMonthly: design.pvgis_monthly,
                  googleKwh: design.google_yearly_kwh,
                  imageryDate: design.imagery_date ? design.imagery_date.toISOString().slice(0, 10) : null,
                }
              : null
          }
          roofStatus={
            design
              ? design.roof_source === "google_solar"
                ? "ok"
                : "drawn"
              : (roof?.status ?? "not_configured")
          }
          aerial={aerial}
          panels={byCat("panel")}
          inverters={byCat("inverter")}
          batteries={byCat("battery")}
          rules={{
            yields: rules.yields,
            zones: rules.zones,
            selfConsumption: rules.selfConsumption,
            settings: rules.settings,
          }}
          survey={{ occupancy, annualUsageKwh: usage, phases }}
          tariff={
            data.energy.unitRatePence !== null && data.energy.exportRatePence !== null
              ? { unitRatePence: data.energy.unitRatePence, exportRatePence: data.energy.exportRatePence }
              : null
          }
          postcode={project.site_postcode ?? ""}
          hasEv={hasEv}
          photos={photos}
        />
      ) : (
        <EvDesigner
          projectId={id}
          initial={data.ev!}
          aerial={aerial}
          chargers={byCat("ev_charger")}
          rules={{ cables: rules.cables, settings: rules.settings }}
          survey={{
            mainFuse: answers.main_fuse ?? null,
            phases,
            earthing: answers.earthing ?? null,
            chargerLocation: answers.charger_location ?? null,
            cableRunM: answers.cable_run_m ? Number(answers.cable_run_m) : null,
            tethered: answers.tethered ?? null,
          }}
          photos={photos}
          solarDesigned={Boolean(design?.annual_kwh_mcs)}
        />
      )}
      {view === "solar" && <EnergyCard projectId={id} energy={data.energy} design={design ?? null} />}
    </div>
  );
}
