-- Gate mode: once the vehicle left, the porter's next step is "Retorno do veículo" (can_return true for him); the app records the physical arrival itself right before the two return checklists.
-- Rollback: rollback/0253_rollback.sql.

create or replace function public.fm_checklist_state(p_reservation_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s jsonb;
begin
 s := public.fm_checklist_state_base(p_reservation_id);
 if public.fm_checklist_by(p_reservation_id) = 'gate' then
  s := s || jsonb_build_object('checklist_by', 'gate');
  if s->>'inspection_role' is distinct from 'security' then s := s || jsonb_build_object('can_pickup', false, 'can_return', false); end if;
 end if;
 -- at the gate the porter's "Retorno do veículo" is ONE step once the vehicle left: the app records the arrival and then both return checklists
 if public.fm_checklist_by(p_reservation_id) = 'gate' and s->>'inspection_role' = 'security'
    and coalesce((s->>'departed')::boolean, false) and not coalesce((s->>'own_return')::boolean, false) and not coalesce((s->>'can_return')::boolean, false)
    and exists (select 1 from reservations r join vehicles v on v.id = r.vehicle_id where r.id = p_reservation_id and r.status = 'confirmed' and v.status in ('in_use', 'returning', 'blocked')) then
  s := s || jsonb_build_object('can_return', true);
 end if;
 if exists (select 1 from carpool_takeovers where reservation_id = p_reservation_id and status = 'offered') then
  s := s || jsonb_build_object('can_pickup', false, 'can_return', false, 'takeover_pending', true);
 end if;
 return s;
end;$$;
