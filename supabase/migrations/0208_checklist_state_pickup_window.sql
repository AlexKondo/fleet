-- 0208 (FIX-VENCIDAS R2) — CONTRACT (tightening of a derived flag only; no ACL, table or policy change).
-- fm_checklist_state now reports can_pickup=false once now() >= reservations.end_at, for both the gate
-- (gate_visual) and the office (key_custody) workflows. The pickup itself was already refused by
-- record_pickup (PICKUP_WINDOW_ENDED, 0177/0198), the key delivery (PICKUP_WINDOW_INVALID, 0178) and
-- the gate departure (OUTSIDE_RESERVATION_WINDOW, 0177/0182); the UI simply stops offering it.
-- Everything else is identical to the 0181 definition: scope check, roles, DEC-01/DEC-02 rules, own_pickup
-- logic, every other flag and every return flag. Backward compatible with the deployed app (same keys and
-- types; only a boolean value changes after the window ended). Rollback: rollback/0208_rollback.sql.
CREATE OR REPLACE FUNCTION public.fm_checklist_state(p_reservation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER SET search_path TO public, pg_temp
AS $function$
declare v_state jsonb;v_vehicle uuid;v_status vehicle_status;v_res_status reservation_status;v_office boolean;v_delivered boolean;v_received boolean;v_end_at timestamptz;v_result jsonb;
begin
 if coalesce(public.fm_is_limited_manager(),false) and not (public.fm_can_manage_reservation(p_reservation_id) or exists(select 1 from public.reservations r join public.trip_requests t on t.id=r.trip_request_id where r.id=p_reservation_id and r.organization_id=public.current_organization_id() and t.requester_id=auth.uid())) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
 v_state:=fm_gate_checklist_state(p_reservation_id);
 select r.vehicle_id,v.status,r.status,r.end_at into v_vehicle,v_status,v_res_status,v_end_at from reservations r join vehicles v on v.id=r.vehicle_id and v.organization_id=r.organization_id where r.id=p_reservation_id and r.organization_id=current_organization_id();
 v_office:=fm_reservation_workflow(p_reservation_id)='key_custody';
 if not v_office then
  v_result:=v_state||jsonb_build_object('workflow','gate_visual','keys_delivered',false,'keys_received',false);
 else
  select exists(select 1 from fm_key_events where reservation_id=p_reservation_id and kind='delivered'),exists(select 1 from fm_key_events where reservation_id=p_reservation_id and kind='received') into v_delivered,v_received;
  v_result:=v_state||jsonb_build_object('workflow','key_custody','keys_delivered',v_delivered,'keys_received',v_received,
   'inspection_role',case when v_state->>'inspection_role'='traveler' then 'traveler' else null end,
   'can_pickup',coalesce(v_state->>'inspection_role'='traveler',false) and v_res_status='confirmed' and v_delivered and not v_received and not (v_state->>'own_pickup')::boolean and v_status in ('available','reserved','awaiting_pickup'),
   'can_return',coalesce(v_state->>'inspection_role'='traveler',false) and v_res_status='confirmed' and v_delivered and (v_state->>'pickup_traveler')::boolean and not (v_state->>'own_return')::boolean and v_status in ('in_use','returning','blocked'));
 end if;
 -- R2: the pickup window is closed once the reservation ended (same boundary as record_pickup: now() >= end_at).
 if v_end_at is null or now()>=v_end_at then v_result:=v_result||jsonb_build_object('can_pickup',false);end if;
 return v_result;
end;$function$
;
