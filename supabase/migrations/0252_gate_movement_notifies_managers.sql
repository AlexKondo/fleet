-- Every physical gate movement (departure released, arrival recorded, departure refused) tells the fleet managers and administrators in the bell.
-- (The e-mail goes from the app, right after the porter confirms.) Best effort: a notification problem never blocks the gate.
create function public.fm_gate_event_notify() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_title text;
begin
  select v.plate, coalesce(v.name, v.plate) as vehicle_name, p.full_name into r
    from reservations res join vehicles v on v.id = res.vehicle_id join trip_requests t on t.id = res.trip_request_id join profiles p on p.id = t.requester_id
   where res.id = new.reservation_id;
  if r.plate is null then return new; end if;
  v_title := case new.kind when 'departure' then 'Saída liberada pela portaria' when 'arrival' then 'Chegada registrada pela portaria' else 'Saída impedida pela portaria' end;
  insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
    select new.organization_id, pr.id, v_title, left(r.vehicle_name || ' (' || r.plate || ') · ' || r.full_name || '.', 500), 'reservation', new.reservation_id
      from profiles pr left join fm_member_access a on a.user_id = pr.id
     where pr.organization_id = new.organization_id and pr.role in ('fleet_manager', 'administrator') and coalesce(a.enabled, true);
  return new;
exception when others then
  raise warning 'fm_gate_event_notify failed: %', sqlerrm;
  return new;
end;
$$;
revoke all on function public.fm_gate_event_notify() from public, anon, authenticated;
create trigger fm_gate_event_notify_trg after insert on public.fm_gate_events for each row execute function public.fm_gate_event_notify();
