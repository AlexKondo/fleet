-- 0230: reserving a vehicle by WhatsApp (text or voice note) through the existing FleetMind assistant. Additive (expand): one new table and
-- three service-role-only functions; nothing existing is changed.
--
-- Identity: the sender's phone must match the WhatsApp registered (with consent) for exactly ONE enabled member of an organization
-- (fm_whatsapp_contacts, screen /settings/approvals). The assistant then acts AS that person (same RLS and rules as the web chat); the
-- reservation still goes through the normal approval. Unknown numbers get NO reply (the line is a personal WhatsApp: nobody outside the
-- fleet registry may be answered or processed).

create table public.fm_whatsapp_inbound (
  message_id text primary key,
  user_id uuid references public.profiles(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('text', 'audio', 'button', 'other')),
  -- true when the assistant processed it (it counts as an open "session" for the next messages); false = ignored
  handled boolean not null default false,
  received_at timestamptz not null default now()
);
create index fm_whatsapp_inbound_user_idx on public.fm_whatsapp_inbound(user_id, received_at desc);
alter table public.fm_whatsapp_inbound enable row level security;
revoke all on public.fm_whatsapp_inbound from public, anon, authenticated;

-- Who is this phone? {ok:true, user_id, organization_id, full_name, email} only for exactly one consented, enabled member.
create function public.fm_whatsapp_identify(p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'); v_norm text; v_n integer; r record;
begin
  -- WhatsApp always sends the country code; a bare Brazilian number (10 or 11 digits) is accepted too
  v_norm := fm_phone_digits_norm(case when length(v_digits) in (10, 11) then '55' || v_digits else v_digits end);
  if v_norm is null or length(v_norm) < 10 then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  select count(*) into v_n
    from fm_whatsapp_contacts c join profiles p on p.id = c.user_id left join fm_member_access a on a.user_id = c.user_id
    where c.consent_confirmed and coalesce(a.enabled, true) and fm_phone_digits_norm(c.phone_e164) = v_norm;
  if v_n = 0 then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  if v_n > 1 then return jsonb_build_object('ok', false, 'reason', 'ambiguous'); end if;
  select c.user_id, p.organization_id, p.full_name, u.email into r
    from fm_whatsapp_contacts c join profiles p on p.id = c.user_id left join fm_member_access a on a.user_id = c.user_id
    left join auth.users u on u.id = c.user_id
    where c.consent_confirmed and coalesce(a.enabled, true) and fm_phone_digits_norm(c.phone_e164) = v_norm;
  if r.email is null then return jsonb_build_object('ok', false, 'reason', 'no_account'); end if;
  return jsonb_build_object('ok', true, 'user_id', r.user_id, 'organization_id', r.organization_id, 'full_name', r.full_name, 'email', r.email);
end;
$$;

-- Records an inbound message once. Returns true the first time a message id is seen, false for a repeat (the webhook may be delivered
-- more than once): the caller then does nothing. Old rows are pruned here (a week is plenty).
create function public.fm_whatsapp_register_inbound(p_message_id text, p_user uuid, p_org uuid, p_kind text, p_handled boolean) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_new boolean;
begin
  if p_message_id is null or btrim(p_message_id) = '' then return true; end if;
  delete from fm_whatsapp_inbound where received_at < now() - interval '7 days';
  insert into fm_whatsapp_inbound(message_id, user_id, organization_id, kind, handled)
    values (left(p_message_id, 200), p_user, p_org, p_kind, coalesce(p_handled, false))
    on conflict (message_id) do nothing;
  get diagnostics v_new = row_count;
  return v_new;
end;
$$;

-- Is the person in an open session? True when the assistant handled one of their messages in the last N minutes.
create function public.fm_whatsapp_session_open(p_user uuid, p_minutes integer default 30) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from fm_whatsapp_inbound where user_id = p_user and handled
                 and received_at > now() - make_interval(mins => greatest(1, least(coalesce(p_minutes, 30), 240))))
$$;

revoke all on function public.fm_whatsapp_identify(text), public.fm_whatsapp_register_inbound(text, uuid, uuid, text, boolean),
  public.fm_whatsapp_session_open(uuid, integer) from public, anon, authenticated;
grant execute on function public.fm_whatsapp_identify(text), public.fm_whatsapp_register_inbound(text, uuid, uuid, text, boolean),
  public.fm_whatsapp_session_open(uuid, integer) to service_role;
