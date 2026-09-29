-- Supports two features:
-- 1. AI-assisted CNH (driver's license) capture on first access: a private storage bucket
--    for the license photo itself, keyed by organization/user so RLS can scope it to the
--    owner without a role-check helper (fleet managers approve manually via
--    /settings/users without ever needing to view the photo — same as today).
-- 2. Expiration email reminders at 6/3/1 months out: one timestamp per threshold so the
--    daily cron job (app/api/cron/license-reminders) sends each reminder exactly once as
--    the countdown crosses it, instead of resending every day it stays within the window.

insert into storage.buckets (id, name, public)
values ('driver-licenses', 'driver-licenses', false)
on conflict (id) do nothing;

create policy "members read own driver license photo" on storage.objects
  for select using (
    bucket_id = 'driver-licenses'
    and (storage.foldername(name))[1] = current_organization_id()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "members upload own driver license photo" on storage.objects
  for insert with check (
    bucket_id = 'driver-licenses'
    and (storage.foldername(name))[1] = current_organization_id()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

alter table profiles
  add column license_reminder_6mo_sent_at timestamptz,
  add column license_reminder_3mo_sent_at timestamptz,
  add column license_reminder_1mo_sent_at timestamptz;
