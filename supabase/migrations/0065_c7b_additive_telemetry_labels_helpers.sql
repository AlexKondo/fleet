-- FleetMind Smart Carpool - Phase C7b: ADDITIVE changes only (safe to apply before the matching app code
-- is deployed; nothing is revoked, dropped or narrowed here - the tightening changes live in
-- supabase/migrations-pending/).
--
--  1. carpool_search_log        - telemetry written by the service role from searchCompatibleCarpool.
--  2. geo_provider_quota_counters: error_count / total_latency_ms + record_geo_provider_call_outcome()
--     (NEW function; increment_geo_provider_quota_counter keeps its exact signature -> no overload).
--  3. carpool_coarse_label()    - same signature (CREATE OR REPLACE, no overload), safer output (L2).
--  4. chat_conversations FKs    - ON DELETE CASCADE (organization_id, user_id) so deleting an org/profile
--                                 cleans chat rows (chat_messages already cascades from the conversation).
--  5. rls_notifiable_user_ids() - NEW helper used by the pending notifications INSERT policy (M2).
--
-- Rollback: supabase/migrations/rollback/0065_rollback.sql (not auto-applied).

-- ---------------------------------------------------------------------------------------------
-- 1. carpool_search_log (NO personal route data: counts, outcome and latency only)

create table public.carpool_search_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  source text not null check (source in ('web', 'chat')),
  offers_evaluated integer not null default 0 check (offers_evaluated >= 0),
  prefilter_candidates integer not null default 0 check (prefilter_candidates >= 0),
  precise_route_calls integer not null default 0 check (precise_route_calls >= 0),
  compatible_count integer not null default 0 check (compatible_count >= 0),
  outcome text not null check (outcome in ('matches', 'none', 'unavailable', 'error')),
  latency_ms integer not null default 0 check (latency_ms >= 0),
  created_at timestamptz not null default now()
);

create index carpool_search_log_org_created_idx on public.carpool_search_log (organization_id, created_at desc);

alter table public.carpool_search_log enable row level security;

create policy "managers read carpool search log" on public.carpool_search_log
  for select using (
    organization_id = (select current_organization_id())
    and (select current_user_role()) in ('fleet_manager', 'administrator')
  );

-- Written only by the service role (Supabase default grants hand authenticated/anon everything on a new
-- table; RLS has no write policy so they could not write anyway - the privileges are removed as well).
revoke all on public.carpool_search_log from anon, authenticated, public;
grant select on public.carpool_search_log to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Cost Guard: errors + latency per (org, kind, day)

alter table public.geo_provider_quota_counters
  add column error_count integer not null default 0 check (error_count >= 0),
  add column total_latency_ms bigint not null default 0 check (total_latency_ms >= 0);

create function public.record_geo_provider_call_outcome(
  p_organization_id uuid,
  p_provider_call_kind text,
  p_day date,
  p_ok boolean,
  p_latency_ms integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.geo_provider_quota_counters (organization_id, provider_call_kind, day, call_count, error_count, total_latency_ms)
  values (p_organization_id, p_provider_call_kind, p_day, 0, case when p_ok then 0 else 1 end, greatest(coalesce(p_latency_ms, 0), 0))
  on conflict (organization_id, provider_call_kind, day)
  do update set error_count = public.geo_provider_quota_counters.error_count + case when p_ok then 0 else 1 end,
                total_latency_ms = public.geo_provider_quota_counters.total_latency_ms + greatest(coalesce(p_latency_ms, 0), 0),
                updated_at = now();
end;
$$;

revoke all on function public.record_geo_provider_call_outcome(uuid, text, date, boolean, integer) from public, anon, authenticated;
grant execute on function public.record_geo_provider_call_outcome(uuid, text, date, boolean, integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. carpool_coarse_label v2 (same signature; used by host_ride_request_places while a request is PENDING)
--
-- Goal: street name WITHOUT the house number / unit, plus one neighbourhood-or-city. Never leaks a number,
-- apartment/block/room, condominium/building/POI names, postal codes or km marks, and never leaves a lone
-- dangling token ("Alameda Santos apto", "Rod. Anhanguera, km", "R. Cel. Xavier de Toledo, Sala").

create or replace function public.carpool_coarse_label(p_label text)
returns text
language plpgsql immutable
set search_path = public
as $$
declare
  s text;
  raw text[];
  seg text[] := '{}';
  x text;
  street text;
  hood text;
  i int;
  n int;
  unit_words constant text := '(apto|apt|ap|apartamento|bloco|bl|torre|sala|conjunto|conj|cj|andar|loja|box|casa|fundos|km|quadra|lote|qd|lt)';
  poi_words constant text := '(condom[ií]nio|condominio|cond|edif[ií]cio|edificio|ed|residencial|resid|shopping|torre|bloco|bl|conjunto|conj|cj|apto|apt|ap|apartamento|sala|loja|andar|box|galp[aã]o|hospital|universidade|faculdade|escola|hotel|pousada|clube|igreja|km|quadra|lote)';
  street_start constant text := '^(rua|r|avenida|av|alameda|al|travessa|tv|pra[cç]a|p[cç]a|rodovia|rod|estrada|est|largo|viela|via|beco|vila|parque|jardim|marginal|acesso|passagem|ladeira|campo)\M';
  state_codes constant text := '^(ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to)$';
begin
  if p_label is null then
    return null;
  end if;
  s := btrim(regexp_replace(p_label, '\s+', ' ', 'g'));
  s := regexp_replace(s, '\m\d{5}-?\d{3}\M', '', 'g');                         -- postal codes (CEP)
  s := regexp_replace(s, ',\s*(brazil|brasil)\s*(,|$)', '\2', 'gi');
  if s ~* '^(brazil|brasil)$' then return null; end if;
  raw := regexp_split_to_array(s, '\s*,\s*');

  -- 1. keep only meaningful segments
  for i in 1 .. coalesce(array_length(raw, 1), 0) loop
    x := btrim(raw[i]);
    if x = '' then continue; end if;
    if x ~ '^[\d\s.+-]*$' then continue; end if;                                -- bare numbers / coordinates
    if x ~* '^s/?n$' then continue; end if;
    if x ~* ('^' || unit_words || '\.?(\s+([[:alpha:]]?\d+[[:alpha:]]?|[[:alpha:]]))*$') then continue; end if;   -- "apto 81", "Bloco B", "Sala", "km 98"
    if x ~* ('\m' || poi_words || '\M') and x !~* street_start and x !~ ' - ' then continue; end if; -- POI / condominium names
    seg := seg || x;
  end loop;

  n := coalesce(array_length(seg, 1), 0);
  -- "1000 - Bela Vista" style segments were dropped above only if purely numeric; keep their neighbourhood
  -- part by re-reading the raw array (a number-first segment with a dash).
  hood := null;
  for i in 1 .. coalesce(array_length(raw, 1), 0) loop
    x := btrim(raw[i]);
    if x ~ '^\d+[[:alpha:]]?\s+-\s+\S' then
      hood := btrim(split_part(x, ' - ', 2));
      exit;
    end if;
  end loop;

  if n = 0 and hood is null then
    return null;
  end if;

  street := null;
  if n >= 1 then
    street := seg[1];
    if street like '% - %' then                                                   -- "Street - Neighbourhood"
      hood := coalesce(hood, btrim(split_part(street, ' - ', 2)));
      street := btrim(split_part(street, ' - ', 1));
    end if;
    -- km references: "Rod. Anhanguera km 98" -> "Rod. Anhanguera"
    street := regexp_replace(street, '\s+km\.?\s*\d.*$', '', 'i');
    -- house number + unit tokens at the end ("1000 apto 81", "nº 12 bloco B", "123A", "s/n")
    street := regexp_replace(street, '\s+s/n\M.*$', '', 'i');
    if street !~* '\m(br|sp|mg|rj|pr|sc|rs|go|mt|ms|ba|pe|ce|es|df|pa|am|to)\s+\d+$' then
      street := regexp_replace(street, '\s+(n[ºo°]\.?\s*)?\d+[[:alpha:]]?(\s+' || unit_words || '\M.*)?$', '', 'i');
    end if;
    street := regexp_replace(street, '^\d+\s+(?=[[:alpha:]])', '');             -- leading "1000 Main St"
    -- a trailing dangling unit token ("Alameda Santos apto") is removed, repeatedly
    for i in 1 .. 4 loop
      street := regexp_replace(street, '\s+(' || replace(replace(unit_words, '(', ''), ')', '') || '|n[ºo°]?|no)\.?$', '', 'i');
    end loop;
    street := btrim(street);
    if street ~ '^[\d\s.+-]*$' or street ~* ('^' || unit_words || '$') then
      street := null;
    end if;
    if street is not null and street !~* street_start and street ~* ('\m' || poi_words || '\M') then
      street := null;
    end if;
  end if;

  -- neighbourhood / city: the next kept segment (after the street), before any " - UF"
  if hood is null then
    for i in 2 .. n loop
      if seg[i] ~ '^\d' then continue; end if;                                 -- "2500 casa 3"
      x := btrim(split_part(seg[i], ' - ', 1));
      if x = '' or lower(x) ~ state_codes then continue; end if;
      x := btrim(regexp_replace(x, '\d+', '', 'g'));
      if x = '' or x ~ '^[\d\s.+-]*$' or lower(x) ~ state_codes then continue; end if;
      hood := x;
      exit;
    end loop;
    if hood is null and street is null and n >= 1 then
      -- only one usable segment and it was not a street (e.g. "Vila Mariana"): use it as the hood
      x := btrim(regexp_replace(btrim(split_part(seg[1], ' - ', 1)), '\d+', '', 'g'));
      if x <> '' and lower(x) !~ state_codes and x !~* ('\m' || poi_words || '\M') then hood := x; end if;
    end if;
  end if;
  if hood is not null then
    hood := btrim(regexp_replace(hood, '\d+', '', 'g'));
    if hood = '' or hood ~ '^[\d\s.+-]*$' or lower(hood) ~ state_codes or hood ~* ('^' || unit_words || '\.?(\s+([[:alpha:]]?\d+[[:alpha:]]?|[[:alpha:]]))*$') then
      hood := null;
    end if;
  end if;

  if street is null or street = '' then
    street := null;
  end if;
  if street is null and hood is null then
    return null;
  end if;
  return left(btrim(case when street is null then hood when hood is null then street else street || ', ' || hood end), 80);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. chat conversation FKs: cascade so deleting an organization / profile removes chat rows

alter table public.chat_conversations drop constraint chat_conversations_organization_id_fkey;
alter table public.chat_conversations
  add constraint chat_conversations_organization_id_fkey
  foreign key (organization_id) references public.organizations (id) on delete cascade;
alter table public.chat_conversations drop constraint chat_conversations_user_id_fkey;
alter table public.chat_conversations
  add constraint chat_conversations_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

-- ---------------------------------------------------------------------------------------------
-- 5. M2 helper (used by the PENDING notifications INSERT policy): users the caller may notify even
--    without a privileged role = managers/administrators of the caller's own organization, plus the
--    host of a trip the caller is a participant of (legacy trip_participants row or a live carpool
--    ride request). Answers only for auth.uid(); SECURITY DEFINER so policy evaluation never
--    recurses into RLS. Granted to authenticated (policies run as the caller); revoked from anon.

create function public.rls_notifiable_user_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select p.id from public.profiles p
    where p.organization_id = (select organization_id from public.profiles where id = auth.uid())
      and p.role in ('fleet_manager', 'administrator')
  union
  select tr.requester_id
    from public.trip_participants tp
    join public.trip_requests tr on tr.id = tp.trip_request_id
    where tp.passenger_id = auth.uid()
  union
  select o.host_id
    from public.carpool_ride_requests rr
    join public.carpool_offers o on o.id = rr.carpool_offer_id
    where rr.rider_id = auth.uid() and rr.status in ('PENDING', 'ACCEPTED')
$$;

revoke all on function public.rls_notifiable_user_ids() from public, anon;
grant execute on function public.rls_notifiable_user_ids() to authenticated;
