-- Rollback of 0201: overdue work orders in execution stop blocking again (0191 behaviour).
CREATE OR REPLACE FUNCTION public.fm_availability_windows(p_from timestamp with time zone DEFAULT now())
 RETURNS TABLE(vehicle_id uuid, start_at timestamp with time zone, end_at timestamp with time zone, kind text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 select r.vehicle_id,r.start_at,r.end_at,'reservation'::text from public.reservations r
 where r.organization_id=public.current_organization_id() and r.status in ('pending_approval','confirmed') and r.end_at>p_from
 union all select o.vehicle_id,o.scheduled_start,o.scheduled_end,'maintenance'::text from public.fm_work_orders o
 where o.organization_id=public.current_organization_id() and o.status in ('scheduled','in_progress','partial') and o.scheduled_end>p_from
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
    and status in ('scheduled','in_progress','partial') and tstzrange(scheduled_start,scheduled_end,'[)') && tstzrange(new.start_at,new.end_at,'[)')) then
   raise exception 'MAINTENANCE_CONFLICT';
  end if;
 end if;return new;
end;$function$;
revoke all on function public.fm_reservation_maintenance_guard() from public,anon,authenticated;
drop function if exists public.fm_work_order_busy_until(text,timestamptz);
