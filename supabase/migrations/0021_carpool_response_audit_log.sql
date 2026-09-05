-- Review finding on ISSUE-016 (0020_carpool_host_acceptance.sql): AUDIT_TRAIL.md lists
-- approval/rejection as a mandatory audited action, and every comparable state-changing
-- RPC (approve_reservation, cancel_reservation, swap_reservation_vehicle, workflow task
-- completion/cancellation — 0015_audit_trail.sql) already calls log_audit_event, but
-- respond_to_carpool_request did not. Especially important here since a rejected
-- trip_participants row is deleted (not soft-marked), so without an audit entry there
-- would be zero durable record that a rejection ever happened once the row is gone.
--
-- Same signature as 0020_carpool_host_acceptance.sql — create or replace keeps the
-- existing grant.

create or replace function respond_to_carpool_request(p_participant_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := current_organization_id();
  v_trip_request_id uuid;
  v_passenger_id uuid;
  v_passenger_count integer;
  v_status text;
  v_host_id uuid;
  v_destination text;
  v_caller_role user_role;
  v_vehicle_capacity integer;
  v_accepted_occupancy integer;
  v_host_base_passengers integer;
begin
  select tp.trip_request_id, tp.passenger_id, tp.passenger_count, tp.status,
         tr.requester_id, tr.destination, tr.passenger_count
    into v_trip_request_id, v_passenger_id, v_passenger_count, v_status,
         v_host_id, v_destination, v_host_base_passengers
    from trip_participants tp
    join trip_requests tr on tr.id = tp.trip_request_id
    where tp.id = p_participant_id and tp.organization_id = v_org_id
    for update of tp;

  if v_trip_request_id is null then
    raise exception 'Carpool request not found';
  end if;

  select role into v_caller_role from profiles where id = auth.uid();
  if auth.uid() is distinct from v_host_id
     and v_caller_role not in ('fleet_manager', 'administrator') then
    raise exception 'Not authorized to respond to this carpool request';
  end if;

  if v_status is distinct from 'pending' then
    raise exception 'CARPOOL_REQUEST_ALREADY_RESOLVED';
  end if;

  if p_accept then
    select vc.passenger_capacity into v_vehicle_capacity
      from reservations r
      join vehicles v on v.id = r.vehicle_id
      join vehicle_categories vc on vc.id = v.category_id
      where r.trip_request_id = v_trip_request_id
      limit 1;

    select coalesce(sum(passenger_count), 0) into v_accepted_occupancy
      from trip_participants
      where trip_request_id = v_trip_request_id and status = 'accepted';

    if v_vehicle_capacity is not null
       and (coalesce(v_host_base_passengers, 0) + v_accepted_occupancy + v_passenger_count) > v_vehicle_capacity then
      raise exception 'CARPOOL_FULL';
    end if;

    update trip_participants set status = 'accepted' where id = p_participant_id;

    insert into notifications (organization_id, user_id, title, body)
    values (
      v_org_id, v_passenger_id, 'Carona aceita',
      'Sua solicitação de carona para ' || v_destination || ' foi aceita pelo motorista.'
    );

    perform log_audit_event(
      v_org_id, auth.uid(), 'carpool_request_accepted', 'trip_participant', p_participant_id,
      jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'accepted', 'passenger_id', v_passenger_id)
    );
  else
    delete from trip_participants where id = p_participant_id;

    insert into notifications (organization_id, user_id, title, body)
    values (
      v_org_id, v_passenger_id, 'Carona recusada',
      'Sua solicitação de carona para ' || v_destination || ' foi recusada pelo motorista.'
    );

    -- entity_id still points at the now-deleted participant row — audit_log.entity_id has
    -- no FK constraint (0015_audit_trail.sql, by design: audit history must survive the
    -- entity it describes being deleted), so this remains a valid, permanent record of
    -- who was rejected even though the trip_participants row itself no longer exists.
    perform log_audit_event(
      v_org_id, auth.uid(), 'carpool_request_rejected', 'trip_participant', p_participant_id,
      jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'rejected', 'passenger_id', v_passenger_id)
    );
  end if;
end;
$$;
