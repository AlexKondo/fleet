-- A vehicle is marked 'reserved' when its reservation is approved and is released by cancel/return. Deleting reservation rows directly
-- (clean-ups, support fixes) skipped that path and left vehicles stuck as 'reserved' with no reservation. This trigger puts the vehicle back to
-- 'available' when the last live reservation that held it is deleted. It only touches a vehicle that is 'reserved' (never in_use, maintenance,
-- blocked, ...) and only when no other confirmed reservation still holds it.
create or replace function public.fm_release_vehicle_on_reservation_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.vehicle_id is not null and old.status in ('pending_approval', 'confirmed') then
    update public.vehicles v
       set status = 'available'
     where v.id = old.vehicle_id
       and v.status = 'reserved'
       and not exists (
         select 1 from public.reservations r
          where r.vehicle_id = old.vehicle_id and r.id <> old.id and r.status = 'confirmed'
       );
  end if;
  return old;
end;
$$;

revoke all on function public.fm_release_vehicle_on_reservation_delete() from public, anon, authenticated;

drop trigger if exists fm_release_vehicle_on_reservation_delete on public.reservations;
create trigger fm_release_vehicle_on_reservation_delete
  after delete on public.reservations
  for each row execute function public.fm_release_vehicle_on_reservation_delete();
