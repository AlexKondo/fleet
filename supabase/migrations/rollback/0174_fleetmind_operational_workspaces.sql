-- Run only after rolling back 0075 and the corresponding application version.
-- Financial, movement, identity or service records must never be silently lost.
begin;
do $$begin
 if exists(select 1 from public.fm_work_orders) or exists(select 1 from public.fm_energy_events)
  or exists(select 1 from public.fm_gate_events) or exists(select 1 from public.fm_incident_acknowledgements)
  or exists(select 1 from public.vehicles where vin is not null or next_service_date is not null) then
  raise exception 'ROLLBACK_REQUIRES_DATA_PRESERVATION_PLAN';
 end if;
end;$$;
drop trigger fm_reservation_maintenance on public.reservations;
drop trigger fm_vehicle_vin_immutable on public.vehicles;
drop function public.fm_reservation_maintenance_guard();
drop function public.fm_immutable_vin();
drop function public.fm_v3_command(text,jsonb,uuid);
drop function public.fm_v3_snapshot();
create or replace function public.get_vehicle_busy_windows(p_from timestamptz default now())
returns table(vehicle_id uuid,start_at timestamptz,end_at timestamptz,status public.reservation_status)
language sql stable security definer set search_path=public as $$
 select r.vehicle_id,r.start_at,r.end_at,r.status from public.reservations r
 where r.organization_id=public.current_organization_id() and r.status in ('pending_approval','confirmed') and r.end_at>p_from
$$;
drop table public.fm_work_order_lines,public.fm_work_orders,public.fm_energy_events,public.fm_gate_events,public.fm_incident_acknowledgements,public.fm_command_receipts;
alter table public.vehicles drop column vin,drop column next_service_date;
commit;
