-- One-time data wipe requested by the user (2026-09-16): clear all existing
-- registrations and operational data, then reseed the single organization
-- (same seed as 0027_single_tenant_seed.sql) so the app is ready for fresh signups.

-- organizations cascades to every tenant table transitively (all "on delete
-- cascade" — vehicle_locations, vehicle_categories, vehicles, trip_requests,
-- reservations, trip_participants, inspections, inspection_photos,
-- workflow_tasks, notifications, audit_log, reservation_messages). This must run
-- before deleting auth.users: several of those tables reference profiles(id)
-- without cascade (e.g. trip_requests.requester_id), so profiles can't be
-- removed while rows still point at it.
truncate table organizations cascade;

-- auth.users cascades to profiles (0001_init_schema.sql:28 "on delete cascade").
delete from auth.users;

insert into organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Fleet');

insert into organization_settings (organization_id)
values ('00000000-0000-0000-0000-000000000001');

insert into vehicle_locations (organization_id, name)
values ('00000000-0000-0000-0000-000000000001', 'Sede');
