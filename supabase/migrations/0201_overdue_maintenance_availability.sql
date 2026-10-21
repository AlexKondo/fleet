-- Pacote 01 correction DEF-05 (DEC-04 D4-05): a work order in execution (in_progress / partial) whose scheduled_end has passed
-- disappeared from fm_availability_windows and stopped blocking new reservations. It now stays unavailable until it is
-- completed or cancelled: its busy window ends at 'infinity' while overdue (scheduled orders keep their planned window).
-- Unauthorized users still see only (vehicle_id,start_at,end_at,kind) - no OS metadata (DEC-04).
-- Consumer check: apps/web/app/trips/new/actions.ts only uses vehicle_id of these rows.
create or replace function public.fm_work_order_busy_until(p_status text,p_scheduled_end timestamptz) returns timestamptz
language sql stable set search_path = public, pg_temp as $$
 select case when p_status in ('in_progress','partial') and (p_scheduled_end is null or p_scheduled_end<=now()) then 'infinity'::timestamptz else p_scheduled_end end
$$;
revoke all on function public.fm_work_order_busy_until(text,timestamptz) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.fm_availability_windows(p_from timestamp with time zone DEFAULT now())
 RETURNS TABLE(vehicle_id uuid, start_at timestamp with time zone, end_at timestamp with time zone, kind text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 select r.vehicle_id,r.start_at,r.end_at,'reservation'::text from public.reservations r
 where r.organization_id=public.current_organization_id() and r.status in ('pending_approval','confirmed') and r.end_at>p_from
 union all select o.vehicle_id,o.scheduled_start,public.fm_work_order_busy_until(o.status,o.scheduled_end),'maintenance'::text from public.fm_work_orders o
 where o.organization_id=public.current_organization_id() and o.status in ('scheduled','in_progress','partial') and public.fm_work_order_busy_until(o.status,o.scheduled_end)>p_from
$function$;
revoke all on function public.fm_availability_windows(timestamptz) from public,anon;
grant execute on function public.fm_availability_windows(timestamptz) to authenticated;

CREATE OR REPLACE FUNCTION public.fm_reservation_maintenance_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if new.status in ('confirmed','pending_approval') then
  perform 1 from public.vehicles where id=new.vehicle_id and organization_id=new.organization_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if exists(select 1 from public.fm_work_orders where vehicle_id=new.vehicle_id and organization_id=new.organization_id
    and status in ('scheduled','in_progress','partial') and tstzrange(scheduled_start,public.fm_work_order_busy_until(status,scheduled_end),'[)') && tstzrange(new.start_at,new.end_at,'[)')) then
   raise exception 'MAINTENANCE_CONFLICT';
  end if;
 end if;return new;
end;$function$;
revoke all on function public.fm_reservation_maintenance_guard() from public,anon,authenticated;
