-- Default design settings agreed with the business (20 Oct 2026); every
-- company can change them in Settings > Design rules.
--   edgeSetbackM 0.4, minDesignTempC -10, g98LimitAPerPhase 16 (ENA G98),
--   pvgisLossPct 14 (PVGIS default), evVoltDropLimitPct 5 (BS 7671 App. 4,
--   other uses), evChargerDiversity 1 (no diversity, BS 7671 722.311),
--   evMilesPerKwh 3.5.
alter table public.companies
  alter column design_settings set default
    '{"edgeSetbackM": 0.4, "minDesignTempC": -10, "g98LimitAPerPhase": 16, "pvgisLossPct": 14, "evVoltDropLimitPct": 5, "evChargerDiversity": 1, "evMilesPerKwh": 3.5}'::jsonb;

-- Existing companies: fill only the settings they haven't set (their own values win).
update public.companies
  set design_settings =
    '{"edgeSetbackM": 0.4, "minDesignTempC": -10, "g98LimitAPerPhase": 16, "pvgisLossPct": 14, "evVoltDropLimitPct": 5, "evChargerDiversity": 1, "evMilesPerKwh": 3.5}'::jsonb
    || design_settings;
