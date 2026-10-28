-- When one WhatsApp number belongs to several profiles and the person has not said which one they are, the first message (text, or a voice note already
-- transcribed) is kept for up to 10 minutes. Once they choose the profile the assistant continues with that request: nobody has to say it all again.
alter table public.fm_whatsapp_pick add column pending_text text;

-- p_pending is new: the signature changes, so the old two-argument function is dropped (no overload is left behind).
drop function public.fm_whatsapp_pick_write(text, uuid);
create function public.fm_whatsapp_pick_write(p_phone_norm text, p_user uuid, p_pending text default null) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_phone_norm is null or length(p_phone_norm) < 10 then return false; end if;
  if p_user is null then
    insert into fm_whatsapp_pick(phone_norm, user_id, asked_at, picked_at, pending_text)
      values (p_phone_norm, null, now(), null, nullif(left(btrim(coalesce(p_pending, '')), 1500), ''))
      on conflict (phone_norm) do update set user_id = null, picked_at = null, asked_at = now(),
        pending_text = coalesce(nullif(left(btrim(coalesce(p_pending, '')), 1500), ''), fm_whatsapp_pick.pending_text);
    return true;
  end if;
  if not exists (select 1 from fm_whatsapp_contacts c where c.user_id = p_user and c.consent_confirmed and fm_phone_digits_norm(c.phone_e164) = p_phone_norm) then return false; end if;
  insert into fm_whatsapp_pick(phone_norm, user_id, asked_at, picked_at, pending_text) values (p_phone_norm, p_user, now(), now(), null)
    on conflict (phone_norm) do update set user_id = p_user, picked_at = now(), pending_text = null;
  return true;
end;
$$;

create or replace function public.fm_whatsapp_pick_state(p_phone_norm text, p_minutes integer default 30) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select jsonb_build_object(
           'picked_user_id', case when picked_at > now() - make_interval(mins => greatest(1, least(coalesce(p_minutes, 30), 240))) then user_id end,
           'asked', asked_at > now() - interval '10 minutes',
           'pending_text', case when asked_at > now() - interval '10 minutes' then pending_text end)
         from fm_whatsapp_pick where phone_norm = p_phone_norm),
         jsonb_build_object('picked_user_id', null, 'asked', false, 'pending_text', null))
$$;

revoke all on function public.fm_whatsapp_pick_write(text, uuid, text) from public, anon, authenticated;
grant execute on function public.fm_whatsapp_pick_write(text, uuid, text) to service_role;
