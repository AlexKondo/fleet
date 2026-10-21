-- 0207 (FIX-VENCIDAS R4) — EXPAND (additive): tolerance after end_at before an open reservation with no
-- operational activity is released automatically by fm_release_expired_reservations (0209).
-- Does not change early_pickup_grace_minutes (pickup may still start that many minutes before start_at).
alter table public.organization_settings
  add column if not exists no_show_release_grace_minutes integer not null default 60;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organization_settings_no_show_release_grace_minutes_check'
                   and conrelid = 'public.organization_settings'::regclass) then
    alter table public.organization_settings
      add constraint organization_settings_no_show_release_grace_minutes_check
      check (no_show_release_grace_minutes >= 0 and no_show_release_grace_minutes <= 1440);
  end if;
end $$;

comment on column public.organization_settings.no_show_release_grace_minutes is
  'Minutes after reservations.end_at before an open reservation (pending_approval/confirmed) with no pickup checklist, gate event or key event is cancelled automatically (no_show_auto / expired_unapproved). 0..1440, default 60.';
