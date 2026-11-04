-- back to the 0251 definition of fm_checklist_state
create or replace function public.fm_checklist_state(p_reservation_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s jsonb;
begin
 s := public.fm_checklist_state_base(p_reservation_id);
 if public.fm_checklist_by(p_reservation_id) = 'gate' then
  s := s || jsonb_build_object('checklist_by', 'gate');
  if s->>'inspection_role' is distinct from 'security' then s := s || jsonb_build_object('can_pickup', false, 'can_return', false); end if;
 end if;
 if exists (select 1 from carpool_takeovers where reservation_id = p_reservation_id and status = 'offered') then
  s := s || jsonb_build_object('can_pickup', false, 'can_return', false, 'takeover_pending', true);
 end if;
 return s;
end;$$;
