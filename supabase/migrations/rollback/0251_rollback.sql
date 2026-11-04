-- back to before 0251: the cancellation is the base one again; the takeover tables and the outbox are dropped (a takeover in progress would be left
-- on the rider's name: finish or cancel those reservations first)
drop function if exists public.fm_takeover_info(uuid);
drop function if exists public.cancel_reservation(uuid, text);
alter function public.cancel_reservation_base(uuid, text) rename to cancel_reservation;
grant execute on function public.cancel_reservation(uuid, text) to authenticated, service_role;
create or replace function public.fm_checklist_state(p_reservation_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s jsonb;
begin
 s := public.fm_checklist_state_base(p_reservation_id);
 if public.fm_checklist_by(p_reservation_id) = 'gate' then
  s := s || jsonb_build_object('checklist_by', 'gate');
  if s->>'inspection_role' is distinct from 'security' then s := s || jsonb_build_object('can_pickup', false, 'can_return', false); end if;
 end if;
 return s;
end;$$;
drop trigger if exists carpool_takeover_decided_trg on public.reservations;
drop function if exists public.fm_takeover_decided();
drop function if exists public.fm_takeover_fleet_notice(uuid);
drop function if exists public.fm_takeover_expire_due();
drop function if exists public.fm_takeover_token_apply(text, text, boolean);
drop function if exists public.fm_takeover_respond(uuid, boolean);
drop function if exists public.fm_takeover_apply(uuid, uuid, boolean);
drop function if exists public.fm_takeover_start(uuid, text);
drop function if exists public.fm_takeover_advance(uuid, text);
drop function if exists public.fm_takeover_release(uuid, text);
drop function if exists public.fm_takeover_notify_offer(uuid);
drop function if exists public.fm_takeover_reason(uuid, uuid, uuid);
drop function if exists public.fm_takeover_deadline(timestamptz);
drop table if exists public.fm_takeover_tokens;
drop table if exists public.carpool_takeovers;
drop trigger if exists fm_notifications_to_whatsapp_trg on public.notifications;
drop function if exists public.fm_notifications_to_whatsapp();
drop function if exists public.fm_wa_outbox_mark(uuid, boolean, text);
drop function if exists public.fm_wa_outbox_claim(integer);
drop function if exists public.fm_wa_enqueue(uuid, uuid, text, text, text, jsonb);
drop table if exists public.fm_whatsapp_outbox;
