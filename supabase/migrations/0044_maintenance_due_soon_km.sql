-- Predictive maintenance's "due soon" window switches from a days-based threshold to a
-- km-remaining threshold (predictMaintenance.ts) — the odometer reading is always exact,
-- unlike the usage-rate estimate the days threshold depended on, so a vehicle can now be
-- flagged "due soon" even with too little check-in history to compute a daily rate at all.
-- 1000km chosen as the new default: roughly what 14 days at the spec's own 110km/day
-- example example works out to (the previous default).
alter table organization_settings
  rename column maintenance_due_soon_days to maintenance_due_soon_km;
alter table organization_settings
  alter column maintenance_due_soon_km set default 1000;
update organization_settings set maintenance_due_soon_km = 1000 where maintenance_due_soon_km = 14;
