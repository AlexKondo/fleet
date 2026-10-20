-- Prevent legacy tenant-wide staff fan-out from leaking an unmanaged vehicle's events.
create function public.fm_notification_scope_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_vehicle uuid;v_role public.user_role;v_allowed boolean;
begin
 select role into v_role from profiles where id=new.user_id and organization_id=new.organization_id;
 if v_role is distinct from 'fleet_manager' or exists(select 1 from fm_manager_scopes where user_id=new.user_id and organization_id=new.organization_id and mode='all_units') then return new;end if;
 -- Personal reservation messages remain available to their own requester independently of management scope.
 if new.entity_type='reservation' then
  if exists(select 1 from reservations r join trip_requests t on t.id=r.trip_request_id where r.id=new.entity_id and r.organization_id=new.organization_id and t.requester_id=new.user_id) then return new;end if;
  select vehicle_id into v_vehicle from reservations where id=new.entity_id and organization_id=new.organization_id;
 elsif new.entity_type='vehicle' then v_vehicle:=new.entity_id;
 elsif new.entity_type='work_order' then select vehicle_id into v_vehicle from fm_work_orders where id=new.entity_id and organization_id=new.organization_id;
 else
  -- Unclassified automated fan-out cannot establish a unit; fail closed for limited managers.
  return null;
 end if;
 select exists(select 1 from fm_vehicle_units b join fm_manager_scope_units g on g.unit_id=b.unit_id and g.organization_id=b.organization_id and g.enabled where b.vehicle_id=v_vehicle and b.organization_id=new.organization_id and g.user_id=new.user_id) into v_allowed;
 if not v_allowed then return null;end if;
 return new;
end;$$;
revoke all on function public.fm_notification_scope_guard() from public,anon,authenticated;
create trigger fm_scoped_staff_notification before insert on public.notifications for each row execute function public.fm_notification_scope_guard();
