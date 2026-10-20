-- Recurrence creates dated intentions, never an automatic reservation or passenger acceptance.
create table public.fm_recurring_carpools (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),owner_id uuid not null references public.profiles(id),
 source_offer_id uuid not null references public.carpool_offers(id),source_trip_id uuid not null references public.trip_requests(id),
 weekdays integer[] not null,start_date date not null,end_date date not null,departure_time time not null,duration interval not null,
 snapshot jsonb not null,status text not null default 'active' check(status in ('active','paused','cancelled')),version integer not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(end_date>=start_date and end_date<=start_date+90),check(duration>interval '0')
);
create table public.fm_recurring_occurrences (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),series_id uuid not null references public.fm_recurring_carpools(id),
 departure_at timestamptz not null,expected_return_at timestamptz not null,status text not null default 'planned' check(status in ('planned','booked','skipped','cancelled')),
 reservation_id uuid references public.reservations(id),version integer not null default 1,unique(series_id,departure_at),unique(reservation_id)
);
create table public.fm_recurring_events (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),series_id uuid not null references public.fm_recurring_carpools(id),
 occurrence_id uuid references public.fm_recurring_occurrences(id),actor_id uuid not null references public.profiles(id),action text not null,reason text not null,created_at timestamptz not null default now()
);
alter table public.fm_recurring_carpools enable row level security;
alter table public.fm_recurring_occurrences enable row level security;
alter table public.fm_recurring_events enable row level security;
revoke all on public.fm_recurring_carpools,public.fm_recurring_occurrences,public.fm_recurring_events from public,anon,authenticated;
grant select on public.fm_recurring_carpools,public.fm_recurring_occurrences,public.fm_recurring_events to authenticated;
create policy fm_recurring_read on public.fm_recurring_carpools for select to authenticated using(organization_id=current_organization_id() and (owner_id=auth.uid() or fm_can_manage_trip(source_trip_id)));
create policy fm_recurring_occurrence_read on public.fm_recurring_occurrences for select to authenticated using(organization_id=current_organization_id() and exists(select 1 from fm_recurring_carpools s where s.id=series_id and (s.owner_id=auth.uid() or fm_can_manage_trip(s.source_trip_id))));
create policy fm_recurring_event_read on public.fm_recurring_events for select to authenticated using(organization_id=current_organization_id() and exists(select 1 from fm_recurring_carpools s where s.id=series_id and (s.owner_id=auth.uid() or fm_can_manage_trip(s.source_trip_id))));
create trigger fm_recurring_event_preserve before update or delete on public.fm_recurring_events for each row execute function public.fm_preserve_inspection_evidence();
create trigger fm_recurring_event_no_truncate before truncate on public.fm_recurring_events for each statement execute function public.fm_preserve_inspection_evidence();
create function public.fm_recurring_command(p_command text,p_payload jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=current_organization_id();v_actor uuid:=auth.uid();v_s fm_recurring_carpools%rowtype;v_o fm_recurring_occurrences%rowtype;v_trip trip_requests%rowtype;v_offer carpool_offers%rowtype;v_days integer[];v_start date;v_end date;v_time time;v_created uuid;v_receipt fm_command_receipts%rowtype;v_result jsonb;v_reason text;
begin
 if v_org is null then raise exception 'NOT_AUTHORIZED';end if;
 if p_command is null or p_command not in ('create','pause','resume','cancel','skip','replan') or p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_INPUT';end if;
 v_reason:=trim(coalesce(p_payload->>'reason',''));if length(v_reason) not between 3 and 1000 then raise exception 'INVALID_INPUT';end if;
 perform 1 from organizations where id=v_org for update;
 if current_organization_id() is distinct from v_org then raise exception 'NOT_AUTHORIZED';end if;
 if p_command='create' then
  select * into v_offer from carpool_offers where id=(p_payload->>'offer_id')::uuid and organization_id=v_org and host_id=v_actor;
  if not found then raise exception 'NOT_AUTHORIZED';end if;
  select * into v_trip from trip_requests where id=v_offer.trip_request_id and organization_id=v_org and requester_id=v_actor;
  if not found then raise exception 'NOT_AUTHORIZED';end if;
 else
  if p_command in ('skip','replan') then
   select * into v_o from fm_recurring_occurrences where id=(p_payload->>'id')::uuid and organization_id=v_org for update;
   if not found then raise exception 'NOT_AUTHORIZED';end if;
   select * into v_s from fm_recurring_carpools where id=v_o.series_id and organization_id=v_org and owner_id=v_actor for update;
  else select * into v_s from fm_recurring_carpools where id=(p_payload->>'id')::uuid and organization_id=v_org and owner_id=v_actor for update;end if;
  if not found then raise exception 'NOT_AUTHORIZED';end if;
 end if;
 insert into fm_command_receipts(organization_id,request_id,actor_id,command,payload) values(v_org,p_request_id,v_actor,'recurring.'||p_command,p_payload) on conflict do nothing returning request_id into v_created;
 if v_created is null then select * into v_receipt from fm_command_receipts where organization_id=v_org and request_id=p_request_id;
  if v_receipt.actor_id<>v_actor or v_receipt.command<>'recurring.'||p_command or v_receipt.payload<>p_payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;return v_receipt.result;
 end if;
 if p_command='create' then
  v_start:=(p_payload->>'start_date')::date;v_end:=(p_payload->>'end_date')::date;v_time:=(p_payload->>'departure_time')::time;
  select array_agg(distinct x::integer order by x::integer) into v_days from jsonb_array_elements_text(p_payload->'weekdays') x;
  if v_start is null or v_end is null or v_time is null or v_start<(now() at time zone 'America/Sao_Paulo')::date or v_end<v_start or v_end>v_start+90 or cardinality(v_days) not between 1 and 7 or v_days is null or exists(select 1 from unnest(v_days) d where d not between 0 and 6 or d is null) or v_trip.expected_return_at-v_trip.departure_at>interval '7 days' then raise exception 'INVALID_INPUT';end if;
  insert into fm_recurring_carpools(organization_id,owner_id,source_offer_id,source_trip_id,weekdays,start_date,end_date,departure_time,duration,snapshot)
   values(v_org,v_actor,v_offer.id,v_trip.id,v_days,v_start,v_end,v_time,v_trip.expected_return_at-v_trip.departure_at,jsonb_build_object('origin',v_trip.origin,'destination',v_trip.destination,'distance_km',v_trip.distance_km,'passenger_count',v_trip.passenger_count,'requires_cargo',v_trip.requires_cargo,'justification',v_trip.justification)) returning * into v_s;
  insert into fm_recurring_occurrences(organization_id,series_id,departure_at,expected_return_at)
   select v_org,v_s.id,(d::date+v_time) at time zone 'America/Sao_Paulo',((d::date+v_time) at time zone 'America/Sao_Paulo')+v_s.duration from generate_series(v_start::timestamp,v_end::timestamp,interval '1 day') d where extract(dow from d)::integer=any(v_days) and (d::date+v_time) at time zone 'America/Sao_Paulo'>now();
  if not found then raise exception 'NO_FUTURE_OCCURRENCE';end if;
 elsif p_command in ('skip','replan') then
  if v_o.version is distinct from (p_payload->>'version')::integer then raise exception 'CONCURRENT_UPDATE';end if;
  if v_s.status<>'active' or (p_command='skip' and v_o.status<>'planned') or (p_command='replan' and (v_o.status not in ('skipped','cancelled') or v_o.departure_at<=now())) then raise exception 'INVALID_STATE_TRANSITION';end if;
  update fm_recurring_occurrences set status=case when p_command='skip' then 'skipped' else 'planned' end,reservation_id=null,version=version+1 where id=v_o.id returning * into v_o;
 else
  if v_s.version is distinct from (p_payload->>'version')::integer then raise exception 'CONCURRENT_UPDATE';end if;
  if v_s.status='cancelled' or (p_command='pause' and v_s.status<>'active') or (p_command='resume' and v_s.status<>'paused') then raise exception 'INVALID_STATE_TRANSITION';end if;
  update fm_recurring_carpools set status=case p_command when 'pause' then 'paused' when 'resume' then 'active' else 'cancelled' end,version=version+1,updated_at=now() where id=v_s.id returning * into v_s;
  if p_command='cancel' then update fm_recurring_occurrences set status='skipped',version=version+1 where series_id=v_s.id and status='planned';end if;
 end if;
 insert into fm_recurring_events(organization_id,series_id,occurrence_id,actor_id,action,reason) values(v_org,v_s.id,v_o.id,v_actor,p_command,v_reason);
 v_result:=jsonb_build_object('id',v_s.id,'version',v_s.version,'status',v_s.status);
 perform log_audit_event(v_org,v_actor,'recurring.'||p_command,'recurring_carpool',v_s.id,null,v_result);
 update fm_command_receipts set result=v_result where organization_id=v_org and request_id=p_request_id;return v_result;
end;$$;
create function public.fm_recurring_reservation_link() returns trigger language plpgsql security definer set search_path=public as $$
declare v_id uuid;v_s uuid;begin
 if TG_OP='UPDATE' and new.status='cancelled' and old.status<>'cancelled' then
  update fm_recurring_occurrences set status='cancelled',version=version+1 where reservation_id=new.id returning id,series_id into v_id,v_s;
 elsif TG_OP='INSERT' and new.status in ('pending_approval','confirmed') then
  select o.id,o.series_id into v_id,v_s from fm_recurring_occurrences o join fm_recurring_carpools s on s.id=o.series_id join trip_requests t on t.id=new.trip_request_id where s.organization_id=new.organization_id and s.owner_id=auth.uid() and s.owner_id=t.requester_id and s.status='active' and o.status='planned' and o.departure_at=t.departure_at and o.expected_return_at=t.expected_return_at and s.snapshot->>'origin'=t.origin and s.snapshot->>'destination'=t.destination order by s.created_at,s.id for update of o limit 1;
  if v_id is not null then update fm_recurring_occurrences set status='booked',reservation_id=new.id,version=version+1 where id=v_id;end if;
 end if;
 if v_id is not null then insert into fm_recurring_events(organization_id,series_id,occurrence_id,actor_id,action,reason) values(new.organization_id,v_s,v_id,auth.uid(),case when new.status='cancelled' then 'reservation_cancelled' else 'reservation_linked' end,'Vínculo ao fluxo normal de reserva; sem aceite automático de passageiros.');end if;
 return new;
end;$$;
create trigger fm_recurring_reservation_link after insert or update of status on public.reservations for each row execute function public.fm_recurring_reservation_link();
create function public.fm_recurring_workspace() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=current_organization_id();begin
 if v_org is null then raise exception 'NOT_AUTHORIZED';end if;
 return jsonb_build_object('series',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('can_edit',s.owner_id=auth.uid()) order by s.created_at desc,s.id) from fm_recurring_carpools s where s.organization_id=v_org and (s.owner_id=auth.uid() or fm_can_manage_trip(s.source_trip_id))),'[]'::jsonb),
 'occurrences',coalesce((select jsonb_agg(to_jsonb(o) order by o.departure_at,o.id) from fm_recurring_occurrences o join fm_recurring_carpools s on s.id=o.series_id where s.organization_id=v_org and (s.owner_id=auth.uid() or fm_can_manage_trip(s.source_trip_id))),'[]'::jsonb),
 'sources',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'origin',t.origin,'destination',t.destination)) from carpool_offers o join trip_requests t on t.id=o.trip_request_id where o.organization_id=v_org and o.host_id=auth.uid() and t.requester_id=auth.uid()),'[]'::jsonb));
end;$$;
revoke all on function public.fm_recurring_reservation_link() from public,anon,authenticated;
revoke all on function public.fm_recurring_command(text,jsonb,uuid),public.fm_recurring_workspace() from public,anon;
grant execute on function public.fm_recurring_command(text,jsonb,uuid),public.fm_recurring_workspace() to authenticated;
