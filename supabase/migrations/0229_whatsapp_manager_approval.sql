-- 0229: approval of a vehicle reservation by the requester's DIRECT MANAGER through WhatsApp (via n8n).
-- Additive (expand): new tables and functions only; approve_reservation / cancel_reservation and every existing permission are untouched.
-- The in-app approval by fleet managers keeps working exactly as before; when it happens first, the WhatsApp request becomes 'superseded'.
--
-- Trust model: the manager's decision arrives ONLY through the service-role webhook (apps/web/app/api/whatsapp/approval, HMAC-signed by n8n).
-- Inside the database the decision is authorized by (1) a single-use random token (only its sha256 is stored), (2) the sender's phone
-- matching the phone registered for that approver, (3) the approver still being the requester's direct manager with an enabled account,
-- (4) the request not being expired / already decided, (5) the reservation still being pending approval.

-- ---------------------------------------------------------------------------
-- Tables (RLS on, no policies, no grants: every access goes through the SECURITY DEFINER functions below)
-- ---------------------------------------------------------------------------
create table public.fm_user_managers (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  manager_id uuid not null references public.profiles(id),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  check (user_id <> manager_id)
);
create index fm_user_managers_manager_idx on public.fm_user_managers(manager_id);

create table public.fm_whatsapp_contacts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{9,14}$'),
  -- the administrator attests that this person agreed to receive approval requests on this number
  consent_confirmed boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.fm_approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  approver_id uuid not null references public.profiles(id),
  channel text not null default 'whatsapp' check (channel in ('whatsapp')),
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired','superseded','cancelled')),
  phone_e164 text not null,
  payload jsonb not null,
  delivery_state text not null default 'queued' check (delivery_state in ('queued','sent','failed')),
  delivery_attempts integer not null default 0,
  delivered_at timestamptz,
  last_error text,
  decision_message_id text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create unique index fm_approval_one_pending_idx on public.fm_approval_requests(reservation_id, approver_id) where status = 'pending';
create index fm_approval_requests_reservation_idx on public.fm_approval_requests(reservation_id);

alter table public.fm_user_managers enable row level security;
alter table public.fm_whatsapp_contacts enable row level security;
alter table public.fm_approval_requests enable row level security;
revoke all on public.fm_user_managers, public.fm_whatsapp_contacts, public.fm_approval_requests from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Digits only; a Brazilian mobile that arrives without the 9th digit (WhatsApp ids of older lines) gets it back, so "5511987654321" and
-- "551187654321" compare equal.
create function public.fm_phone_digits_norm(p_phone text) returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when d ~ '^55[1-9][0-9][6-9][0-9]{7}$' then substr(d, 1, 4) || '9' || substr(d, 5)
    else d
  end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) s
$$;

-- ---------------------------------------------------------------------------
-- Administration (called by the signed-in administrator through the app)
-- ---------------------------------------------------------------------------
create function public.fm_set_user_manager(p_user_id uuid, p_manager_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := current_organization_id(); v_before uuid;
begin
  if auth.uid() is null or v_org is null or current_user_role() <> 'administrator' then raise exception 'NOT_AUTHORIZED'; end if;
  if not exists (select 1 from profiles where id = p_user_id and organization_id = v_org) then raise exception 'NOT_FOUND'; end if;
  select manager_id into v_before from fm_user_managers where user_id = p_user_id;
  if p_manager_id is null then
    delete from fm_user_managers where user_id = p_user_id;
  else
    if p_manager_id = p_user_id then raise exception 'INVALID_INPUT'; end if;
    if not exists (select 1 from profiles p left join fm_member_access a on a.user_id = p.id where p.id = p_manager_id and p.organization_id = v_org and coalesce(a.enabled, true)) then
      raise exception 'INVALID_MANAGER';
    end if;
    insert into fm_user_managers(user_id, organization_id, manager_id, updated_by, updated_at)
      values (p_user_id, v_org, p_manager_id, auth.uid(), now())
      on conflict (user_id) do update set manager_id = excluded.manager_id, updated_by = excluded.updated_by, updated_at = now();
  end if;
  perform log_audit_event(v_org, auth.uid(), 'approval.manager_set', 'profile', p_user_id,
    jsonb_build_object('manager_id', v_before), jsonb_build_object('manager_id', p_manager_id));
end;
$$;

create function public.fm_set_whatsapp_contact(p_user_id uuid, p_phone text, p_consent boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := current_organization_id(); v_phone text; v_digits text;
begin
  if auth.uid() is null or v_org is null or current_user_role() <> 'administrator' then raise exception 'NOT_AUTHORIZED'; end if;
  if not exists (select 1 from profiles where id = p_user_id and organization_id = v_org) then raise exception 'NOT_FOUND'; end if;
  if p_phone is null or btrim(p_phone) = '' then
    delete from fm_whatsapp_contacts where user_id = p_user_id;
    perform log_audit_event(v_org, auth.uid(), 'approval.whatsapp_removed', 'profile', p_user_id, null, null);
    return;
  end if;
  v_digits := regexp_replace(p_phone, '[^0-9]', '', 'g');
  -- a number typed without country code is a Brazilian one
  if length(v_digits) in (10, 11) then v_digits := '55' || v_digits; end if;
  v_phone := '+' || v_digits;
  if v_phone !~ '^\+[1-9][0-9]{9,14}$' then raise exception 'INVALID_PHONE'; end if;
  if not coalesce(p_consent, false) then raise exception 'CONSENT_REQUIRED'; end if;
  insert into fm_whatsapp_contacts(user_id, organization_id, phone_e164, consent_confirmed, updated_by, updated_at)
    values (p_user_id, v_org, v_phone, true, auth.uid(), now())
    on conflict (user_id) do update set phone_e164 = excluded.phone_e164, consent_confirmed = true, updated_by = excluded.updated_by, updated_at = now();
  -- the phone itself is personal data: the audit keeps only the last 4 digits
  perform log_audit_event(v_org, auth.uid(), 'approval.whatsapp_set', 'profile', p_user_id, null,
    jsonb_build_object('phone_suffix', right(v_phone, 4)));
end;
$$;

-- What the administration screen shows: the manager link and the registered number of every member of the caller's organization.
create function public.fm_approval_channel_snapshot() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := current_organization_id();
begin
  if auth.uid() is null or v_org is null or current_user_role() <> 'administrator' then raise exception 'NOT_AUTHORIZED'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', p.id, 'manager_id', m.manager_id, 'phone_e164', c.phone_e164, 'consent', coalesce(c.consent_confirmed, false)
    ) order by p.full_name)
    from profiles p
    left join fm_user_managers m on m.user_id = p.id
    left join fm_whatsapp_contacts c on c.user_id = p.id
    where p.organization_id = v_org
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: the approve / refuse effects, performed on behalf of the approver (mirrors approve_reservation / the pending branch of
-- cancel_reservation, which both authorize through auth.uid() and the fleet-manager role and so cannot be called for a line manager).
-- ---------------------------------------------------------------------------
create function public.fm_channel_approve(p_reservation_id uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_vehicle_id uuid; v_vehicle_status vehicle_status; v_requester uuid;
begin
  select r.organization_id, r.vehicle_id, t.requester_id into v_org, v_vehicle_id, v_requester
    from reservations r join trip_requests t on t.id = r.trip_request_id where r.id = p_reservation_id;
  if v_vehicle_id is null then raise exception 'NOT_FOUND'; end if;
  select status into v_vehicle_status from vehicles where id = v_vehicle_id for update;
  if v_vehicle_status in ('maintenance', 'blocked') then raise exception 'VEHICLE_NOT_AVAILABLE'; end if;
  perform 1 from reservations where id = p_reservation_id and vehicle_id = v_vehicle_id and organization_id = v_org for update;
  if not found then raise exception 'CONCURRENT_UPDATE'; end if;
  if exists (select 1 from reservations where id = p_reservation_id and end_at <= now()) then raise exception 'RESERVATION_EXPIRED'; end if;
  update reservations set status = 'confirmed', approved_by = p_actor, approved_at = now()
    where id = p_reservation_id and status = 'pending_approval';
  if not found then raise exception 'NOT_PENDING'; end if;
  if v_vehicle_status = 'available' then
    update vehicles set status = 'reserved', updated_at = now() where id = v_vehicle_id;
  end if;
  insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
    values (v_org, v_requester, 'Reserva aprovada', 'Sua reserva foi aprovada e o veículo está confirmado.', 'reservation', p_reservation_id);
  perform log_audit_event(v_org, p_actor, 'reservation_approved', 'reservation', p_reservation_id, null,
    jsonb_build_object('status', 'confirmed', 'channel', 'whatsapp'));
end;
$$;

create function public.fm_channel_reject(p_reservation_id uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_vehicle_id uuid; v_requester uuid;
begin
  select r.organization_id, r.vehicle_id, t.requester_id into v_org, v_vehicle_id, v_requester
    from reservations r join trip_requests t on t.id = r.trip_request_id where r.id = p_reservation_id;
  if v_vehicle_id is null then raise exception 'NOT_FOUND'; end if;
  perform 1 from vehicles where id = v_vehicle_id for update;
  update reservations set status = 'cancelled', cancelled_by = p_actor, cancelled_at = now(),
      cancellation_reason = 'Recusada pelo gestor (WhatsApp)'
    where id = p_reservation_id and status = 'pending_approval';
  if not found then raise exception 'NOT_PENDING'; end if;
  insert into notifications (organization_id, user_id, title, body, entity_type, entity_id)
    values (v_org, v_requester, 'Reserva recusada', 'Seu gestor recusou esta reserva de veículo.', 'reservation', p_reservation_id);
  perform log_audit_event(v_org, p_actor, 'reservation_rejected', 'reservation', p_reservation_id, null,
    jsonb_build_object('status', 'cancelled', 'channel', 'whatsapp'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Request lifecycle (service role only: called by the server, never by a browser)
-- ---------------------------------------------------------------------------
-- Creates the request for a reservation that is pending approval and returns what the message needs, including the plain token
-- (shown once, only its hash is kept). p_rotate replaces a still-pending request (delivery retry) with a new token.
create function public.fm_approval_prepare(p_reservation_id uuid, p_rotate boolean default false, p_ttl_hours integer default 24) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record; v_manager uuid; v_phone text; v_token text; v_id uuid; v_expires timestamptz; v_payload jsonb;
begin
  select res.id, res.organization_id, res.status, res.start_at, res.end_at, t.requester_id, t.origin, t.destination, t.justification,
         t.passenger_count, t.departure_at, t.expected_return_at, v.plate, v.name as vehicle_name, p.full_name as requester_name
    into r
    from reservations res
    join trip_requests t on t.id = res.trip_request_id
    join vehicles v on v.id = res.vehicle_id
    join profiles p on p.id = t.requester_id
    where res.id = p_reservation_id;
  if r.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if r.status <> 'pending_approval' then return jsonb_build_object('ok', false, 'reason', 'not_pending'); end if;
  if r.end_at <= now() then return jsonb_build_object('ok', false, 'reason', 'reservation_expired'); end if;

  select m.manager_id into v_manager from fm_user_managers m
    join profiles mp on mp.id = m.manager_id left join fm_member_access a on a.user_id = m.manager_id
    where m.user_id = r.requester_id and mp.organization_id = r.organization_id and coalesce(a.enabled, true);
  if v_manager is null then return jsonb_build_object('ok', false, 'reason', 'no_manager'); end if;
  select c.phone_e164 into v_phone from fm_whatsapp_contacts c where c.user_id = v_manager and c.consent_confirmed;
  if v_phone is null then return jsonb_build_object('ok', false, 'reason', 'no_contact'); end if;

  if exists (select 1 from fm_approval_requests where reservation_id = p_reservation_id and approver_id = v_manager and status = 'pending') then
    if not p_rotate then return jsonb_build_object('ok', false, 'reason', 'already_pending'); end if;
    update fm_approval_requests set status = 'cancelled' where reservation_id = p_reservation_id and approver_id = v_manager and status = 'pending';
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_expires := least(now() + make_interval(hours => greatest(1, least(coalesce(p_ttl_hours, 24), 72))), r.end_at);
  v_payload := jsonb_build_object(
    'requester_name', r.requester_name, 'vehicle_name', r.vehicle_name, 'plate', r.plate,
    'departure_at', r.departure_at, 'return_at', r.expected_return_at,
    'origin', r.origin, 'destination', r.destination, 'purpose', r.justification, 'passengers', r.passenger_count);
  insert into fm_approval_requests(organization_id, reservation_id, approver_id, token_hash, phone_e164, payload, expires_at)
    values (r.organization_id, p_reservation_id, v_manager, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_phone, v_payload, v_expires)
    returning id into v_id;
  perform log_audit_event(r.organization_id, null, 'approval.requested', 'reservation', p_reservation_id, null,
    jsonb_build_object('approver_id', v_manager, 'channel', 'whatsapp', 'request_id', v_id));
  return jsonb_build_object('ok', true, 'request_id', v_id, 'token', v_token, 'phone_e164', v_phone, 'expires_at', v_expires, 'payload', v_payload);
end;
$$;

create function public.fm_approval_mark_delivery(p_request_id uuid, p_ok boolean, p_error text default null) returns void
language sql security definer set search_path = public, pg_temp as $$
  update fm_approval_requests
     set delivery_state = case when p_ok then 'sent' else 'failed' end,
         delivery_attempts = delivery_attempts + 1,
         delivered_at = case when p_ok then now() else delivered_at end,
         last_error = case when p_ok then null else left(coalesce(p_error, 'error'), 300) end
   where id = p_request_id and status = 'pending';
$$;

-- The manager's answer. Never raises for a business outcome: returns {status, reservation_id} so the webhook can answer n8n with a
-- text for the manager. Statuses: approved | rejected | already_decided | expired | invalid | phone_mismatch | not_authorized |
-- vehicle_unavailable | superseded.
create function public.fm_approval_decide(p_token text, p_decision text, p_from_phone text, p_message_id text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q fm_approval_requests%rowtype; v_res_status reservation_status; v_requester uuid; v_ok boolean; v_err text;
begin
  if p_token is null or length(p_token) < 32 or p_decision not in ('approve', 'reject') then return jsonb_build_object('status', 'invalid'); end if;
  select * into q from fm_approval_requests where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') for update;
  if not found then return jsonb_build_object('status', 'invalid'); end if;

  -- the same button tapped twice (or the same webhook delivery repeated): same answer, no second effect
  if q.status in ('approved', 'rejected') then
    return jsonb_build_object('status', case when q.decision_message_id is not distinct from p_message_id and p_message_id is not null
      then q.status else 'already_decided' end, 'reservation_id', q.reservation_id);
  end if;
  if q.status = 'superseded' or q.status = 'cancelled' then return jsonb_build_object('status', 'superseded', 'reservation_id', q.reservation_id); end if;
  if q.status = 'expired' or q.expires_at <= now() then
    update fm_approval_requests set status = 'expired' where id = q.id and status = 'pending';
    return jsonb_build_object('status', 'expired', 'reservation_id', q.reservation_id);
  end if;

  if fm_phone_digits_norm(p_from_phone) is distinct from fm_phone_digits_norm(q.phone_e164) or fm_phone_digits_norm(p_from_phone) = '' then
    perform log_audit_event(q.organization_id, null, 'approval.phone_mismatch', 'reservation', q.reservation_id, null,
      jsonb_build_object('request_id', q.id, 'from_suffix', right(fm_phone_digits_norm(p_from_phone), 4)));
    return jsonb_build_object('status', 'phone_mismatch', 'reservation_id', q.reservation_id);
  end if;

  select t.requester_id, r.status into v_requester, v_res_status
    from reservations r join trip_requests t on t.id = r.trip_request_id where r.id = q.reservation_id;
  if v_res_status is distinct from 'pending_approval' then
    update fm_approval_requests set status = 'superseded', decided_at = now() where id = q.id;
    return jsonb_build_object('status', 'superseded', 'reservation_id', q.reservation_id);
  end if;

  -- still the direct manager of the requester, same registered number, account enabled
  if not exists (
    select 1 from fm_user_managers m
      join fm_whatsapp_contacts c on c.user_id = m.manager_id and c.consent_confirmed
      left join fm_member_access a on a.user_id = m.manager_id
     where m.user_id = v_requester and m.manager_id = q.approver_id and coalesce(a.enabled, true)
       and fm_phone_digits_norm(c.phone_e164) = fm_phone_digits_norm(q.phone_e164)
  ) then
    perform log_audit_event(q.organization_id, null, 'approval.not_authorized', 'reservation', q.reservation_id, null,
      jsonb_build_object('request_id', q.id));
    return jsonb_build_object('status', 'not_authorized', 'reservation_id', q.reservation_id);
  end if;

  begin
    if p_decision = 'approve' then perform fm_channel_approve(q.reservation_id, q.approver_id);
    else perform fm_channel_reject(q.reservation_id, q.approver_id); end if;
    v_ok := true;
  exception when others then
    v_ok := false; v_err := sqlerrm;
  end;
  if not v_ok then
    if v_err = 'RESERVATION_EXPIRED' then
      update fm_approval_requests set status = 'expired', decided_at = now() where id = q.id;
      return jsonb_build_object('status', 'expired', 'reservation_id', q.reservation_id);
    elsif v_err = 'VEHICLE_NOT_AVAILABLE' then
      return jsonb_build_object('status', 'vehicle_unavailable', 'reservation_id', q.reservation_id);
    end if;
    return jsonb_build_object('status', 'superseded', 'reservation_id', q.reservation_id);
  end if;

  update fm_approval_requests set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
      decided_at = now(), decision_message_id = p_message_id where id = q.id;
  update fm_approval_requests set status = 'superseded', decided_at = now()
    where reservation_id = q.reservation_id and id <> q.id and status = 'pending';
  return jsonb_build_object('status', case when p_decision = 'approve' then 'approved' else 'rejected' end, 'reservation_id', q.reservation_id);
end;
$$;

-- Housekeeping: pending requests past their expiry are closed (the decision function also checks the clock itself).
create function public.fm_approval_expire_due() returns integer
language sql security definer set search_path = public, pg_temp as $$
  with x as (update fm_approval_requests set status = 'expired' where status = 'pending' and expires_at <= now() returning 1)
  select count(*)::integer from x
$$;

-- Grants: administration functions are called by the signed-in administrator; everything else is service_role only.
revoke all on function public.fm_phone_digits_norm(text) from public, anon, authenticated;
revoke all on function public.fm_set_user_manager(uuid, uuid), public.fm_set_whatsapp_contact(uuid, text, boolean), public.fm_approval_channel_snapshot() from public, anon;
grant execute on function public.fm_set_user_manager(uuid, uuid), public.fm_set_whatsapp_contact(uuid, text, boolean), public.fm_approval_channel_snapshot() to authenticated;
revoke all on function public.fm_channel_approve(uuid, uuid), public.fm_channel_reject(uuid, uuid), public.fm_approval_prepare(uuid, boolean, integer),
  public.fm_approval_mark_delivery(uuid, boolean, text), public.fm_approval_decide(text, text, text, text), public.fm_approval_expire_due()
  from public, anon, authenticated;
grant execute on function public.fm_approval_prepare(uuid, boolean, integer), public.fm_approval_mark_delivery(uuid, boolean, text),
  public.fm_approval_decide(text, text, text, text), public.fm_approval_expire_due() to service_role;
