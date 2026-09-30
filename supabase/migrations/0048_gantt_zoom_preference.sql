-- Per-user Gantt zoom preference for the reservation timeline (dashboard + trips pages).
-- Defaults to 'month' per product request.
alter table public.profiles
  add column if not exists gantt_zoom_preference text not null default 'month'
    check (gantt_zoom_preference in ('week', 'month', 'quarter'));
