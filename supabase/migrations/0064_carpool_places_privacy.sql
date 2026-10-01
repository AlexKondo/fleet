-- FleetMind Smart Carpool - Phase C7 (privacy), part B: minimise the exact addresses a host sees
-- BEFORE accepting a ride request (pack 06 "minimize exact personal route disclosure").
--
-- Until now the host's My Trip section read carpool_ride_requests.pickup_location / dropoff_location
-- with the host's own JWT, so the rider's exact pickup/drop-off address was visible on a PENDING
-- request (and a host could always read them directly over PostgREST). Also, the host_origin_snapshot /
-- host_destination_snapshot columns (the host's own origin/destination text, kept for revalidation)
-- were readable by the rider.
--
-- DESIGN: the four sensitive columns are removed from the `authenticated` SELECT privilege (column-level
-- revoke; the definer lifecycle functions read them as the owner and are unaffected). The host reads the
-- places ONLY through host_ride_request_places(trip_request_id), which
--   * answers only for the host of an offer on that trip (no rows for anyone else),
--   * returns a COARSE label (street name without house number + neighbourhood/city, no postal code,
--     no coordinates) while the request is PENDING,
--   * returns the full stored label only when the request is ACCEPTED,
--   * returns nothing for REJECTED / CANCELLED / EXPIRED / INVALIDATED requests.
-- The coarse label is derived from the stored label by carpool_coarse_label() (pure SQL, internal).
--
-- No existing function is replaced (all names below are new). Rollback:
-- supabase/migrations/rollback/0064_rollback.sql.

create function public.carpool_coarse_label(p_label text)
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

create function public.host_ride_request_places(p_trip_request_id uuid)
returns table (
  request_id uuid,
  rider_id uuid,
  status text,
  pickup_label text,
  dropoff_label text,
  is_exact boolean
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return query
    select rr.id,
           rr.rider_id,
           rr.status,
           case rr.status
             when 'ACCEPTED' then nullif(btrim(rr.pickup_location ->> 'label'), '')
             when 'PENDING' then public.carpool_coarse_label(rr.pickup_location ->> 'label')
             else null
           end,
           case rr.status
             when 'ACCEPTED' then nullif(btrim(rr.dropoff_location ->> 'label'), '')
             when 'PENDING' then public.carpool_coarse_label(rr.dropoff_location ->> 'label')
             else null
           end,
           (rr.status = 'ACCEPTED')
      from public.carpool_ride_requests rr
      join public.carpool_offers o on o.id = rr.carpool_offer_id
      where o.trip_request_id = p_trip_request_id
        and o.host_id = auth.uid()
        and o.organization_id = public.current_organization_id();
end;
$$;

revoke all on function public.carpool_coarse_label(text) from public, anon, authenticated;
revoke all on function public.host_ride_request_places(uuid) from public, anon;
grant execute on function public.host_ride_request_places(uuid) to authenticated;

-- Column-level revoke: places + the host's own origin/destination snapshots are not readable directly.
revoke select on public.carpool_ride_requests from authenticated;
grant select (
  id, organization_id, carpool_offer_id, rider_id, requested_seats, requested_departure_at, status,
  match_additional_distance_km, match_additional_time_min, policy_version, created_at, updated_at,
  responded_at, responded_by, client_request_id, status_reason
) on public.carpool_ride_requests to authenticated;
