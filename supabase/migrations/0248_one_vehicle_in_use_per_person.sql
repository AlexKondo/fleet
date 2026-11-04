-- Rule: a person cannot take out (departure / pickup) a vehicle while the one they already took out is not returned.
-- record_pickup (the same function as 0215) refuses a NEW pickup with PREVIOUS_VEHICLE_NOT_RETURNED when the requester of the reservation has another
-- confirmed reservation with a recorded pickup and no recorded return. Rollback: rollback/0248_rollback.sql (back to the 0215 body).

CREATE OR REPLACE FUNCTION public.record_pickup(p_reservation_id uuid, p_odometer_km integer, p_fuel_level_percent numeric, p_battery_level_percent numeric, p_has_damage boolean, p_damage_notes text, p_missing_safety_equipment text[], p_is_dirty_exterior boolean, p_is_dirty_interior boolean, p_role inspection_role)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid:=current_organization_id();v_vehicle uuid;v_id uuid;v_req uuid;
begin
 -- 0248: a person cannot take out a vehicle while the one already taken out was not returned. Only a NEW pickup is checked (an exact retry of a recorded one stays
 -- idempotent); "in use" = a confirmed reservation of the same requester with a pickup and no return recorded.
 select tr.requester_id into v_req from reservations r join trip_requests tr on tr.id=r.trip_request_id where r.id=p_reservation_id and r.organization_id=v_org;
 if v_req is not null and not exists(select 1 from inspections where reservation_id=p_reservation_id and type='pickup') and exists(
   select 1 from reservations r2 join trip_requests t2 on t2.id=r2.trip_request_id
    where t2.requester_id=v_req and r2.organization_id=v_org and r2.id<>p_reservation_id and r2.status='confirmed'
      and exists(select 1 from inspections i where i.reservation_id=r2.id and i.type='pickup')
      and not exists(select 1 from inspections i where i.reservation_id=r2.id and i.type='return')) then
  raise exception 'PREVIOUS_VEHICLE_NOT_RETURNED';
 end if;
 select vehicle_id into v_vehicle from reservations where id=p_reservation_id and organization_id=v_org;
 if fm_reservation_workflow(p_reservation_id)='key_custody' then
  if p_role is distinct from 'traveler' then raise exception 'OFFICE_DRIVER_CHECKLIST_ONLY';end if;
  perform 1 from organizations where id=v_org for no key update;
  perform 1 from vehicles where id=v_vehicle and organization_id=v_org for update;
  if not exists(select 1 from fm_key_events where reservation_id=p_reservation_id and kind='delivered') then raise exception 'KEY_DELIVERY_REQUIRED';end if;
  -- Exact retry after the trip started stays idempotent. A receipt without a
  -- pickup, however, ends the key handover and cannot start a new trip.
  if exists(select 1 from fm_key_events where reservation_id=p_reservation_id and kind='received') and not exists(select 1 from inspections where reservation_id=p_reservation_id and type='pickup' and performed_by=auth.uid() and actor_role_at_recording is not null) then raise exception 'KEYS_ALREADY_RECEIVED';end if;
  -- 0215 (S1-05): the digital pickup is the office departure. A new pickup of an unsafe vehicle is refused with the
  -- same code as the physical gate (DEPARTURE_BLOCKED); an exact retry of a recorded pickup stays idempotent.
  if not exists(select 1 from inspections where reservation_id=p_reservation_id and type='pickup')
   and public.fm_vehicle_unsafe_reason(v_vehicle) is not null then raise exception 'DEPARTURE_BLOCKED';end if;
  v_id:=fm_gate_record_pickup(p_reservation_id,p_odometer_km,p_fuel_level_percent,p_battery_level_percent,p_has_damage,p_damage_notes,p_missing_safety_equipment,p_is_dirty_exterior,p_is_dirty_interior,p_role);
  -- The driver's digital pickup starts the office trip. This is not an IRA
  -- physical gate event. Damage/missing equipment holds the car blocked.
  update vehicles set status=case when status='blocked' or has_blocking_damage or cardinality(missing_safety_equipment)>0 then 'blocked'::vehicle_status else 'in_use'::vehicle_status end,updated_at=now() where id=v_vehicle and status in ('awaiting_pickup','in_use','blocked');
  return v_id;
 end if;
 return fm_gate_record_pickup(p_reservation_id,p_odometer_km,p_fuel_level_percent,p_battery_level_percent,p_has_damage,p_damage_notes,p_missing_safety_equipment,p_is_dirty_exterior,p_is_dirty_interior,p_role);
end;$function$;
