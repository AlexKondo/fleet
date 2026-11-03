-- A person cannot hold two vehicles in the same period. The site and the chat already refuse it; this is the guarantee at the database, for any path
-- (a race between two requests, a new channel). Checked when a reservation is created or its period / status changes; back-to-back is fine ([) ranges).
create or replace function public.fm_one_vehicle_per_person_per_period()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_requester uuid;
begin
  if new.status not in ('pending_approval', 'confirmed') then return new; end if;
  select t.requester_id into v_requester from public.trip_requests t where t.id = new.trip_request_id;
  if v_requester is null then return new; end if;
  if exists (
    select 1 from public.reservations r
      join public.trip_requests t on t.id = r.trip_request_id
     where t.requester_id = v_requester
       and r.id <> new.id
       and r.status in ('pending_approval', 'confirmed')
       and tstzrange(r.start_at, r.end_at, '[)') && tstzrange(new.start_at, new.end_at, '[)')
  ) then
    raise exception 'USER_RESERVATION_OVERLAP' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.fm_one_vehicle_per_person_per_period() from public, anon, authenticated;

drop trigger if exists fm_one_vehicle_per_person_per_period on public.reservations;
create trigger fm_one_vehicle_per_person_per_period
  before insert or update of status, start_at, end_at on public.reservations
  for each row execute function public.fm_one_vehicle_per_person_per_period();
