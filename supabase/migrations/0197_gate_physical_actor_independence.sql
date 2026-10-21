-- Pacote 01 correction DEF-01 (DEC-01 D1-03/D1-04): gate.record (departure / arrival / denied) is a PHYSICAL release event.
-- Before: fm_v3_command accepted fleet_manager and administrator (in scope), even for their own trip, and a security user
-- could release the trip they requested. After: only role 'security', never the reservation's requester.
-- Key-custody units keep their own physical actor (fm_key_command: enabled custodian of the unit, independent of the
-- requester) and fm_gate_unit_only still refuses gate events there (OFFICE_HAS_NO_GATE).
-- Managers/administrators keep READ access (fm_gate_read / fm_v3_snapshot) and incident.ack; no grant is removed.
-- Error codes: NOT_AUTHORIZED (role), GATE_SELF_RELEASE_NOT_AUTHORIZED (requester; the app regex maps it to NOT_AUTHORIZED).
create or replace function public.fm_gate_physical_actor_guard(p_reservation_id uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid:=public.current_organization_id();v_role public.user_role;
begin
 select role into v_role from public.profiles where id=auth.uid() and organization_id=v_org;
 if auth.uid() is null or v_org is null or v_role is distinct from 'security' then raise exception 'NOT_AUTHORIZED';end if;
 if exists(select 1 from public.reservations r join public.trip_requests t on t.id=r.trip_request_id and t.organization_id=r.organization_id
  where r.id=p_reservation_id and r.organization_id=v_org and t.requester_id=auth.uid()) then raise exception 'GATE_SELF_RELEASE_NOT_AUTHORIZED';end if;
end;$$;
revoke all on function public.fm_gate_physical_actor_guard(uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.fm_scope_command_guard(p_command text, p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_vehicle uuid;
begin
 -- 0197 (DEF-01): the physical gate events are recorded only by an independent security actor.
 if p_command='gate.record' then perform public.fm_gate_physical_actor_guard(nullif(p_payload->>'reservation_id','')::uuid);end if;
 if not coalesce(fm_is_limited_manager(),false) then return;end if;
 if p_command in ('work_order.create','energy.record','vehicle.identity') then v_vehicle:=(p_payload->>'vehicle_id')::uuid;
 elsif p_command in ('work_order.transition','work_order.line','work_order.void_line','work_order.budget','work_order.approve_budget') then select vehicle_id into v_vehicle from fm_work_orders where id=(p_payload->>'id')::uuid and organization_id=current_organization_id();
 elsif p_command='energy.void' then select vehicle_id into v_vehicle from fm_energy_events where id=(p_payload->>'id')::uuid and organization_id=current_organization_id();
 elsif p_command='gate.record' then select vehicle_id into v_vehicle from reservations where id=(p_payload->>'reservation_id')::uuid and organization_id=current_organization_id();
 elsif p_command='incident.ack' then select vehicle_id into v_vehicle from inspections where id=(p_payload->>'inspection_id')::uuid and organization_id=current_organization_id();
 else raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
 if not fm_can_manage_vehicle(v_vehicle) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
end;$function$;
revoke all on function public.fm_scope_command_guard(text,jsonb) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.fm_verified_departure_checks()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_traveler uuid;v_security uuid;v_requester uuid;v_authorized boolean;v_expiry date;v_enabled boolean;
begin
 -- 0197 (DEF-01): defence in depth at table level, also for writers other than fm_v3_command.
 if not exists(select 1 from profiles where id=new.created_by and organization_id=new.organization_id and role='security') then raise exception 'NOT_AUTHORIZED';end if;
 if exists(select 1 from reservations r join trip_requests t on t.id=r.trip_request_id and t.organization_id=r.organization_id where r.id=new.reservation_id and r.organization_id=new.organization_id and t.requester_id=new.created_by) then raise exception 'GATE_SELF_RELEASE_NOT_AUTHORIZED';end if;
 if new.kind='arrival' and exists(select 1 from inspections where reservation_id=new.reservation_id and type='pickup' and actor_role_at_recording is not null)
 and not exists(select 1 from fm_gate_events where reservation_id=new.reservation_id and kind='departure') then raise exception 'PHYSICAL_DEPARTURE_REQUIRED';end if;
 if new.kind<>'departure' then return new;end if;
 if exists(select 1 from fm_gate_events where reservation_id=new.reservation_id and kind='arrival') then raise exception 'MOVEMENT_SEQUENCE_INVALID';end if;
 select performed_by into v_traveler from inspections where reservation_id=new.reservation_id and organization_id=new.organization_id and type='pickup' and performed_by_role='traveler' and actor_role_at_recording is not null;
 select performed_by into v_security from inspections where reservation_id=new.reservation_id and organization_id=new.organization_id and type='pickup' and performed_by_role='security' and actor_role_at_recording='security';
 if v_traveler is null or v_security is null or v_traveler=v_security then raise exception 'CHECKLIST_REQUIRED';end if;
 select p.id,p.driver_authorized,p.drivers_license_expiration,coalesce(a.enabled,true) into v_requester,v_authorized,v_expiry,v_enabled
 from reservations r join trip_requests t on t.id=r.trip_request_id join profiles p on p.id=t.requester_id left join fm_member_access a on a.user_id=p.id
 where r.id=new.reservation_id and r.organization_id=new.organization_id and t.organization_id=new.organization_id and p.organization_id=new.organization_id;
 if v_requester is distinct from v_traveler then raise exception 'CHECKLIST_REQUIRED';end if;
 perform fm_assert_can_drive(v_requester,new.organization_id);
 if not coalesce(v_authorized,false) or not coalesce(v_enabled,false) then raise exception 'DRIVER_NOT_AUTHORIZED';end if;
 if v_expiry is null or v_expiry<(now() at time zone 'America/Sao_Paulo')::date then raise exception 'LICENSE_EXPIRED';end if;
 if exists(select 1 from inspections i where i.reservation_id=new.reservation_id and i.type='pickup' and i.actor_role_at_recording is not null and i.has_new_damage
 and not exists(select 1 from inspection_photos p where p.inspection_id=i.id and p.angle='damage' and p.organization_id=i.organization_id)) then raise exception 'DAMAGE_EVIDENCE_REQUIRED';end if;
 return new;
end;$function$;
revoke all on function public.fm_verified_departure_checks() from public,anon,authenticated;
