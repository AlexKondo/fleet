-- Checked definer commands own task writes; drivers see availability, never internal task notes.
revoke insert,delete on public.workflow_tasks from public,anon,authenticated;
create policy fm_internal_workflow_task_read on public.workflow_tasks as restrictive for select to authenticated
using(organization_id=current_organization_id() and (current_user_role()='maintenance_operator' or (current_user_role() in ('fleet_manager','administrator') and fm_can_manage_vehicle(vehicle_id))));
create or replace function approve_reservation(p_reservation_id uuid)
returns void
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_vehicle_id uuid;
  v_vehicle_status vehicle_status;
  v_requester_id uuid;
begin
 if auth.uid() is null or public.current_organization_id() is null then raise exception 'NOT_AUTHORIZED';end if;
 if public.current_user_role() not in ('fleet_manager','administrator') or not coalesce(public.fm_can_manage_reservation(p_reservation_id),false) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;

  select vehicle_id into v_vehicle_id from reservations where id = p_reservation_id;
  if v_vehicle_id is null then
    raise exception 'Reservation not found';
  end if;

  select status into v_vehicle_status from vehicles where id = v_vehicle_id for update;
  if v_vehicle_status in ('maintenance', 'blocked') then
    raise exception 'Vehicle is not available to approve (current status: %)', v_vehicle_status;
  end if;

  perform 1 from reservations where id=p_reservation_id and vehicle_id=v_vehicle_id and organization_id=current_organization_id() for update;
  if not found then raise exception 'CONCURRENT_UPDATE';end if;
  if exists(select 1 from reservations where id=p_reservation_id and end_at<=now()) then raise exception 'RESERVATION_EXPIRED';end if;
  update reservations
    set status = 'confirmed', approved_by = auth.uid(), approved_at = now()
    where id = p_reservation_id and status = 'pending_approval';
  if not found then
    raise exception 'Reservation is not pending approval';
  end if;

  if v_vehicle_status = 'available' then
    update vehicles set status = 'reserved', updated_at = now() where id = v_vehicle_id;
  end if;

  select tr.requester_id into v_requester_id
    from reservations r join trip_requests tr on tr.id = r.trip_request_id
    where r.id = p_reservation_id;

  insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
  values (
    current_organization_id(), v_requester_id, 'Reserva aprovada',
    'Sua reserva foi aprovada e o veículo está confirmado.',
    'reservation', p_reservation_id
  );

  perform log_audit_event(
    current_organization_id(), auth.uid(), 'reservation_approved', 'reservation',
    p_reservation_id, null, jsonb_build_object('status', 'confirmed')
  );
end;
$$;

