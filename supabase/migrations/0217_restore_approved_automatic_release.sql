-- Forward correction; preserve Kondo 0215/0216. No cancellation or grace change.
begin;
alter table public.organization_settings alter column auto_release_enabled set default true;
update public.organization_settings set auto_release_enabled=true where not auto_release_enabled;

-- No settings row also means the approved active default; retain grace fallback and all F1 safety checks.
CREATE OR REPLACE FUNCTION public.fm_release_expired_reservations(p_organization_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '2s'
AS $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  c record;
  v_res public.reservations%rowtype;
  v_vehicle_status public.vehicle_status;
  v_requester uuid;
  v_grace integer;
  v_reason text;
  v_restored boolean;
  v_after public.vehicle_status;
  v_released integer := 0;
  v_restored_count integer := 0;
  v_skipped_activity integer := 0;
  v_skipped_locked integer := 0;
begin
  -- Expired open reservations WITH activity are reported, never touched.
  select count(*) into v_skipped_activity
    from reservations r
    left join organization_settings s on s.organization_id = r.organization_id
   where r.status in ('pending_approval', 'confirmed')
     and coalesce(s.auto_release_enabled,true)
     and (p_organization_id is null or r.organization_id = p_organization_id)
     and r.end_at + make_interval(mins => coalesce(s.no_show_release_grace_minutes, 60)) < now()
     and (exists (select 1 from inspections i where i.reservation_id = r.id)
          or exists (select 1 from fm_gate_events g where g.reservation_id = r.id)
          or exists (select 1 from fm_key_events k where k.reservation_id = r.id));

  for c in
    select r.id, r.vehicle_id, r.organization_id
      from reservations r
      left join organization_settings s on s.organization_id = r.organization_id
     where r.status in ('pending_approval', 'confirmed')
       and coalesce(s.auto_release_enabled,true)
     and (p_organization_id is null or r.organization_id = p_organization_id)
       and r.end_at + make_interval(mins => coalesce(s.no_show_release_grace_minutes, 60)) < now()
       and not exists (select 1 from inspections i where i.reservation_id = r.id)
       and not exists (select 1 from fm_gate_events g where g.reservation_id = r.id)
       and not exists (select 1 from fm_key_events k where k.reservation_id = r.id)
     order by r.vehicle_id, r.end_at, r.id
     limit v_limit
  loop
    begin
      -- Canonical order (0194): vehicle first, then the reservation.
      select status into v_vehicle_status from vehicles
       where id = c.vehicle_id and organization_id = c.organization_id
       for update nowait;
      select * into v_res from reservations
       where id = c.id and organization_id = c.organization_id
       for update nowait;
    exception when lock_not_available then
      v_skipped_locked := v_skipped_locked + 1;
      continue;
    end;

    -- Re-check everything under the locks (the row may have moved on since the candidate scan).
    if exists(select 1 from organization_settings where organization_id=c.organization_id and not auto_release_enabled) then continue;end if;
    select coalesce(no_show_release_grace_minutes, 60) into v_grace
      from organization_settings where organization_id = c.organization_id;
    v_grace := coalesce(v_grace, 60);
    if v_res.id is null
       or v_res.vehicle_id is distinct from c.vehicle_id
       or v_res.status not in ('pending_approval', 'confirmed')
       or v_res.end_at + make_interval(mins => v_grace) >= now() then
      continue;
    end if;
    if exists (select 1 from inspections where reservation_id = c.id)
       or exists (select 1 from fm_gate_events where reservation_id = c.id)
       or exists (select 1 from fm_key_events where reservation_id = c.id) then
      v_skipped_activity := v_skipped_activity + 1;
      continue;
    end if;

    v_reason := case when v_res.status = 'confirmed' then 'no_show_auto' else 'expired_unapproved' end;
    update reservations
       set status = 'cancelled', cancelled_by = null, cancelled_at = now(), cancellation_reason = v_reason
     where id = c.id and status = v_res.status;

    v_restored := false;
    v_after := null;
    if v_res.status = 'confirmed' and v_vehicle_status in ('reserved', 'awaiting_pickup')
       and not exists (select 1 from reservations
                        where vehicle_id = c.vehicle_id and id <> c.id and status = 'confirmed') then
      -- 0215 (S1-02): single safety check. Safe -> available; unsafe -> blocked (documentation/archived) or
      -- maintenance (work order, damage, missing equipment), never 'reserved' without an active reservation.
      v_after := coalesce(public.fm_vehicle_unsafe_status(c.vehicle_id), 'available'::public.vehicle_status);
      update vehicles set status = v_after, updated_at = now()
       where id = c.vehicle_id and status = v_vehicle_status;
      if not found then v_after := null; end if;
      v_restored := v_after is not null and v_after = 'available';
    end if;

    select requester_id into v_requester from trip_requests
     where id = v_res.trip_request_id and organization_id = c.organization_id;
    if v_requester is not null then
      insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
      values (
        c.organization_id, v_requester,
        case when v_reason = 'no_show_auto' then 'Reserva não retirada' else 'Solicitação de reserva expirada' end,
        case when v_reason = 'no_show_auto'
          then 'O período da sua reserva terminou sem a retirada do veículo; ela foi cancelada automaticamente. A disponibilidade do veículo foi reavaliada conforme suas condições.'
          else 'O período da sua solicitação de reserva terminou sem aprovação; ela foi cancelada automaticamente.'
        end,
        'reservation', c.id
      );
    end if;

    insert into audit_log (organization_id, actor_id, actor_role, action, entity_type, entity_id, before, after)
    values (
      c.organization_id, null, null, 'reservation.no_show_released', 'reservation', c.id,
      jsonb_build_object('status', v_res.status, 'vehicle_id', c.vehicle_id, 'vehicle_status', v_vehicle_status, 'end_at', v_res.end_at),
      jsonb_build_object('status', 'cancelled', 'reason', v_reason, 'grace_minutes', v_grace,
                         'vehicle_status', coalesce(v_after::text, v_vehicle_status::text))
    );

    v_released := v_released + 1;
    if v_restored then v_restored_count := v_restored_count + 1; end if;
  end loop;

  return jsonb_build_object(
    'released', v_released,
    'vehicles_released', v_restored_count,
    'skipped_with_activity', v_skipped_activity,
    'skipped_locked', v_skipped_locked
  );
end;
$function$;
commit;
