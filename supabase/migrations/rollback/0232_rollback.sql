-- Rollback of 0232: drops the profile-pick helpers and restores fm_whatsapp_identify as 0230 defined it (ambiguous number: no answer).
drop function if exists public.fm_whatsapp_pick_write(text, uuid);
drop function if exists public.fm_whatsapp_pick_state(text, integer);
drop table if exists public.fm_whatsapp_pick;
create or replace function public.fm_whatsapp_identify(p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'); v_norm text; v_n integer; r record;
begin
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
