-- Rollback of 0236: back to 0232's two-argument pick_write and the pick_state without the pending request.
drop function if exists public.fm_whatsapp_pick_write(text, uuid, text);
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
revoke all on function public.fm_whatsapp_pick_write(text, uuid) from public, anon, authenticated;
grant execute on function public.fm_whatsapp_pick_write(text, uuid) to service_role;
create or replace function public.fm_whatsapp_pick_state(p_phone_norm text, p_minutes integer default 30) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select jsonb_build_object(
           'picked_user_id', case when picked_at > now() - make_interval(mins => greatest(1, least(coalesce(p_minutes, 30), 240))) then user_id end,
           'asked', asked_at > now() - interval '10 minutes')
         from fm_whatsapp_pick where phone_norm = p_phone_norm),
         jsonb_build_object('picked_user_id', null, 'asked', false))
$$;
alter table public.fm_whatsapp_pick drop column if exists pending_text;
