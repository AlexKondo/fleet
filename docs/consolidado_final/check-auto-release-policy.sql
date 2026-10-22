-- READ ONLY. No cancellation, update or cleanup.
select count(*)=0 as all_explicit_settings_enabled from public.organization_settings where not auto_release_enabled;
select column_default='true' as new_settings_default_enabled from information_schema.columns
where table_schema='public' and table_name='organization_settings' and column_name='auto_release_enabled';
-- 0217 also gives organizations without a settings row the approved active default inside the release function.
