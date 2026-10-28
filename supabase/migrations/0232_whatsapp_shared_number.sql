-- One WhatsApp number can be registered on several people of the company (e.g. the same person with a collaborator, a security and an
-- administrator profile). The assistant then asks which profile the person is speaking as, and remembers the answer for 30 minutes.
-- fm_whatsapp_identify keeps its signature (create or replace, no new overload): for an ambiguous number it now also returns the candidates.

create table public.fm_whatsapp_pick (
  phone_norm text primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  asked_at timestamptz not null default now(),
  picked_at timestamptz
);
alter table public.fm_whatsapp_pick enable row level security;
revoke all on public.fm_whatsapp_pick from public, anon, authenticated;

create or replace function public.fm_whatsapp_identify(p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'); v_norm text; v_n integer; r record; v_list jsonb;
begin
  v_norm := fm_phone_digits_norm(case when length(v_digits) in (10, 11) then '55' || v_digits else v_digits end);
  if v_norm is null or length(v_norm) < 10 then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  select count(*), coalesce(jsonb_agg(jsonb_build_object('user_id', c.user_id, 'organization_id', p.organization_id, 'full_name', p.full_name, 'role', p.role, 'email', u.email)
                                       order by p.role::text, p.full_name, c.user_id), '[]'::jsonb)
    into v_n, v_list
    from fm_whatsapp_contacts c join profiles p on p.id = c.user_id left join fm_member_access a on a.user_id = c.user_id left join auth.users u on u.id = c.user_id
    where c.consent_confirmed and coalesce(a.enabled, true) and u.email is not null and fm_phone_digits_norm(c.phone_e164) = v_norm;
  if v_n = 0 then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  if v_n > 1 then return jsonb_build_object('ok', false, 'reason', 'ambiguous', 'phone_norm', v_norm, 'candidates', v_list); end if;
  return jsonb_build_object('ok', true, 'user_id', v_list->0->>'user_id', 'organization_id', v_list->0->>'organization_id', 'full_name', v_list->0->>'full_name', 'email', v_list->0->>'email');
end;
$$;

-- {picked_user_id: uuid|null, asked: boolean}: the profile chosen in the last p_minutes, and whether the question was sent in the last 10 minutes.
create function public.fm_whatsapp_pick_state(p_phone_norm text, p_minutes integer default 30) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select jsonb_build_object(
           'picked_user_id', case when picked_at > now() - make_interval(mins => greatest(1, least(coalesce(p_minutes, 30), 240))) then user_id end,
           'asked', asked_at > now() - interval '10 minutes')
         from fm_whatsapp_pick where phone_norm = p_phone_norm),
         jsonb_build_object('picked_user_id', null, 'asked', false))
$$;

-- Records the question (p_user null) or the answer. The answer must be one of the people registered with that number.
create function public.fm_whatsapp_pick_write(p_phone_norm text, p_user uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_phone_norm is null or length(p_phone_norm) < 10 then return false; end if;
  if p_user is null then
    insert into fm_whatsapp_pick(phone_norm, user_id, asked_at, picked_at) values (p_phone_norm, null, now(), null)
      on conflict (phone_norm) do update set user_id = null, picked_at = null, asked_at = now();
    return true;
  end if;
  if not exists (select 1 from fm_whatsapp_contacts c where c.user_id = p_user and c.consent_confirmed and fm_phone_digits_norm(c.phone_e164) = p_phone_norm) then return false; end if;
  insert into fm_whatsapp_pick(phone_norm, user_id, asked_at, picked_at) values (p_phone_norm, p_user, now(), now())
    on conflict (phone_norm) do update set user_id = p_user, picked_at = now();
  return true;
end;
$$;

revoke all on function public.fm_whatsapp_pick_state(text, integer), public.fm_whatsapp_pick_write(text, uuid) from public, anon, authenticated;
grant execute on function public.fm_whatsapp_pick_state(text, integer), public.fm_whatsapp_pick_write(text, uuid) to service_role;
