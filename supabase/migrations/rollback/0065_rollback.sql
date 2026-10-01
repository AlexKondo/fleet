-- Rollback for 0065_c7b_additive_telemetry_labels_helpers.sql (NOT auto-applied).
-- Restores the 0064 carpool_coarse_label body, removes the new objects, and puts the chat FKs back to NO ACTION.
-- Roll the app back first (searchCompatibleCarpool / costGuard write to the dropped objects, best-effort).
drop function if exists public.rls_notifiable_user_ids();
alter table public.chat_conversations drop constraint chat_conversations_organization_id_fkey;
alter table public.chat_conversations add constraint chat_conversations_organization_id_fkey foreign key (organization_id) references public.organizations (id);
alter table public.chat_conversations drop constraint chat_conversations_user_id_fkey;
alter table public.chat_conversations add constraint chat_conversations_user_id_fkey foreign key (user_id) references public.profiles (id);
drop function if exists public.record_geo_provider_call_outcome(uuid, text, date, boolean, integer);
alter table public.geo_provider_quota_counters drop column if exists error_count, drop column if exists total_latency_ms;
drop table if exists public.carpool_search_log;

create or replace function public.carpool_coarse_label(p_label text)
returns text
language plpgsql immutable
set search_path = public
as $$
declare
  s text;
  seg text[];
  street text;
  second text;
  hood text;
  result text;
begin
  if p_label is null then
    return null;
  end if;
  s := btrim(regexp_replace(p_label, '\s+', ' ', 'g'));
  s := regexp_replace(s, '\m\d{5}-?\d{3}\M', '', 'g');                  -- postal codes (CEP)
  s := regexp_replace(s, ',\s*(brazil|brasil)\s*(,|$)', '\2', 'gi');
  seg := array(
    select btrim(x) from unnest(regexp_split_to_array(s, '\s*,\s*')) x where btrim(x) <> ''
  );
  if coalesce(array_length(seg, 1), 0) = 0 then
    return null;
  end if;

  street := seg[1];
  -- "Street - Neighbourhood" in the first segment (some providers format it that way)
  if street like '% - %' then
    hood := btrim(split_part(street, ' - ', 2));
    street := btrim(split_part(street, ' - ', 1));
  end if;
  -- strip the house number: trailing "123", "nº 123", "123A", "s/n", leading "123 Main St"
  street := regexp_replace(street, '\s+s/n$', '', 'i');
  street := regexp_replace(street, '\s+(n[ºo°]\.?\s*)?\d+[[:alpha:]]?$', '', 'i');
  street := regexp_replace(street, '^\d+\s+(?=[[:alpha:]])', '');
  if street ~ '^[\d\s.+-]*$' then
    street := '';                                                          -- e.g. a bare "lat, lng" label
  end if;

  if hood is null and array_length(seg, 1) >= 2 then
    second := seg[2];
    if second ~ '^\d' then
      -- "1000 - Bela Vista": number first, neighbourhood after the dash (never the number)
      if second like '% - %' then
        hood := btrim(split_part(second, ' - ', 2));
      end if;
    else
      -- "Sao Paulo" / "Iracemapolis - SP": the city / neighbourhood is the part before the dash
      hood := btrim(split_part(second, ' - ', 1));
    end if;
  end if;
  if hood is not null then
    hood := btrim(regexp_replace(hood, '\d+', '', 'g'));
    if hood = '' or hood ~ '^[\d\s.+-]*$' then
      hood := null;
    end if;
  end if;

  if street = '' then
    result := hood;
  elsif hood is null then
    result := street;
  else
    result := street || ', ' || hood;
  end if;
  if result is null or btrim(result) = '' then
    return null;
  end if;
  return left(btrim(result), 80);
end;
$$;
