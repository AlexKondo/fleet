-- Single-tenant conversion: seed the one organization every signup will join.
-- Multi-tenant scaffolding (organization_id + RLS) is left in place — cheap to keep,
-- reversible later — but the app now always resolves to this one row instead of
-- creating a new organization per signup. See ADR-009 and DECISION_LOG.md.

insert into organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Fleet')
on conflict (id) do nothing;

insert into organization_settings (organization_id)
values ('00000000-0000-0000-0000-000000000001')
on conflict (organization_id) do nothing;

insert into vehicle_locations (organization_id, name)
select '00000000-0000-0000-0000-000000000001', 'Sede'
where not exists (
  select 1 from vehicle_locations where organization_id = '00000000-0000-0000-0000-000000000001'
);
