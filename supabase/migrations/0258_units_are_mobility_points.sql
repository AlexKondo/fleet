-- A unit IS a mobility point. They were two registers of the same places: the people and vehicle screens read fm_units while the company registered its
-- plants and offices as corporate_mobility_points, so "Unidades e chaves" listed nothing. Now each point has its unit, kept in step, and each vehicle follows the
-- point of its home location.
-- Nothing changes for a reservation: a unit starts as 'gate_visual', the process a vehicle without a unit already followed, and who does the checklist still comes
-- from the point (0250). Deactivating a point does not disable its unit, because that would stop reservations; the screens just stop offering it.
-- Rollback: rollback/0258_rollback.sql.

alter table public.fm_units add column if not exists mobility_point_id uuid references public.corporate_mobility_points(id) on delete set null;
create unique index if not exists fm_units_mobility_point on public.fm_units(mobility_point_id) where mobility_point_id is not null;

-- a unit already registered under the name of a point is that point
update public.fm_units u set mobility_point_id = p.id
  from public.corporate_mobility_points p
 where u.organization_id = p.organization_id and u.mobility_point_id is null and lower(trim(u.name)) = lower(trim(p.name));

insert into public.fm_units(organization_id, name, enabled, workflow, mobility_point_id)
select p.organization_id, left(trim(p.name), 120), true, 'gate_visual', p.id
  from public.corporate_mobility_points p
 where not exists (select 1 from public.fm_units u where u.mobility_point_id = p.id)
on conflict do nothing;

-- every vehicle without a unit takes the one of its home location
insert into public.fm_vehicle_units(vehicle_id, organization_id, unit_id)
select v.id, v.organization_id, u.id
  from public.vehicles v
  join public.vehicle_locations l on l.id = v.home_location_id and l.organization_id = v.organization_id
  join public.fm_units u on u.mobility_point_id = l.mobility_point_id and u.organization_id = v.organization_id
on conflict (vehicle_id) do nothing;

create or replace function public.fm_point_unit_sync() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  if TG_OP = 'DELETE' then
    -- the unit stays for the history of its reservations; its vehicles go back to having no unit
    delete from fm_vehicle_units m using fm_units u where m.unit_id = u.id and u.mobility_point_id = old.id;
    update fm_units set enabled = false, version = version + 1 where mobility_point_id = old.id;
    return old;
  end if;
  if TG_OP = 'UPDATE' then
    update fm_units set name = left(trim(new.name), 120), version = version + 1
      where mobility_point_id = new.id and name is distinct from left(trim(new.name), 120);
    return new;
  end if;
  update fm_units set mobility_point_id = new.id
    where organization_id = new.organization_id and mobility_point_id is null and lower(trim(name)) = lower(trim(new.name));
  if not found then
    insert into fm_units(organization_id, name, enabled, workflow, mobility_point_id)
    values (new.organization_id, left(trim(new.name), 120), true, 'gate_visual', new.id);
  end if;
  return new;
end;
$function$;
drop trigger if exists fm_point_unit_insert on public.corporate_mobility_points;
create trigger fm_point_unit_insert after insert on public.corporate_mobility_points
  for each row execute function public.fm_point_unit_sync();
drop trigger if exists fm_point_unit_rename on public.corporate_mobility_points;
create trigger fm_point_unit_rename after update of name on public.corporate_mobility_points
  for each row execute function public.fm_point_unit_sync();
drop trigger if exists fm_point_unit_delete on public.corporate_mobility_points;
create trigger fm_point_unit_delete before delete on public.corporate_mobility_points
  for each row execute function public.fm_point_unit_sync();

-- Same rule as the unit.vehicle command: a vehicle with an open reservation or keys out stays where it is. p_replace is false for a new vehicle, whose creator may
-- have chosen the unit in the form.
create or replace function public.fm_vehicle_follows_location(p_vehicle_id uuid, p_replace boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $function$
declare v_org uuid; v_unit uuid;
begin
  select v.organization_id, u.id into v_org, v_unit
    from vehicles v
    join vehicle_locations l on l.id = v.home_location_id and l.organization_id = v.organization_id
    join fm_units u on u.mobility_point_id = l.mobility_point_id and u.organization_id = v.organization_id
   where v.id = p_vehicle_id;
  if v_unit is null then return; end if;
  if exists (select 1 from reservations where vehicle_id = p_vehicle_id and status in ('pending_approval', 'confirmed')) then return; end if;
  if exists (select 1 from fm_key_events e where e.vehicle_id = p_vehicle_id and e.kind = 'delivered'
             and not exists (select 1 from fm_key_events r where r.reservation_id = e.reservation_id and r.kind = 'received')) then return; end if;
  insert into fm_vehicle_units(vehicle_id, organization_id, unit_id) values (p_vehicle_id, v_org, v_unit)
  on conflict (vehicle_id) do update set unit_id = excluded.unit_id, version = fm_vehicle_units.version + 1
    where p_replace and fm_vehicle_units.unit_id is distinct from excluded.unit_id;
end;
$function$;

create or replace function public.fm_vehicle_unit_on_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  perform fm_vehicle_follows_location(new.id, TG_OP = 'UPDATE');
  return null;
end;
$function$;
-- deferred: fm_management_create_vehicle inserts the unit picked in the form right after the vehicle, and that insert must not find this one first
drop trigger if exists fm_vehicle_unit_follows_location on public.vehicles;
create constraint trigger fm_vehicle_unit_follows_location after insert or update of home_location_id on public.vehicles
  deferrable initially deferred for each row execute function public.fm_vehicle_unit_on_change();

create or replace function public.fm_location_units_on_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare v_vehicle uuid;
begin
  for v_vehicle in select id from vehicles where home_location_id = new.id and organization_id = new.organization_id loop
    perform fm_vehicle_follows_location(v_vehicle, true);
  end loop;
  return new;
end;
$function$;
drop trigger if exists fm_location_point_moves_vehicles on public.vehicle_locations;
create trigger fm_location_point_moves_vehicles after update of mobility_point_id on public.vehicle_locations
  for each row when (old.mobility_point_id is distinct from new.mobility_point_id) execute function public.fm_location_units_on_change();

revoke all on function public.fm_point_unit_sync() from public, anon, authenticated;
revoke all on function public.fm_vehicle_follows_location(uuid, boolean) from public, anon, authenticated;
revoke all on function public.fm_vehicle_unit_on_change() from public, anon, authenticated;
revoke all on function public.fm_location_units_on_change() from public, anon, authenticated;
