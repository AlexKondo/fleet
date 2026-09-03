-- Organization-level configurability for predictive maintenance's "due soon" window and
-- the São Paulo traffic-restriction check (fleet-car-saas.txt §8 "Range Safety Buffer
-- configurável", §12 Predictive Maintenance, §15 São Paulo Traffic Restriction
-- Intelligence). Both previously existed only as hardcoded defaults in
-- packages/domain (defaultMaintenancePredictionConfig.dueSoonDays = 14,
-- defaultTrafficRestrictionConfig applied unconditionally) with no per-tenant override.
--
-- Defaults below match those existing code defaults exactly, so applying this migration
-- changes no organization's observed behavior until a fleet_manager/administrator edits
-- the new /settings page.
--
-- No RLS changes: organization_settings' existing policies (0001_init_schema.sql) —
-- "members read own organization settings" (select) and "fleet managers manage
-- organization settings" (all, restricted to fleet_manager/administrator) — are row-level
-- (scoped by organization_id = current_organization_id()), not column-level, so they
-- already cover these two new columns without modification.

alter table organization_settings
  add column maintenance_due_soon_days integer not null default 14,
  add column traffic_restriction_enabled boolean not null default true;
