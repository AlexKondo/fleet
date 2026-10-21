-- Rollback of 0207 (apply AFTER rollback/0209_rollback.sql, which uses the column).
alter table public.organization_settings drop constraint if exists organization_settings_no_show_release_grace_minutes_check;
alter table public.organization_settings drop column if exists no_show_release_grace_minutes;
