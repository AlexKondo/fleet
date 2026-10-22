-- T1 fixture (LOCAL ONLY). Cria Org T1A (3 unidades: SP gate_visual, Campinas key_custody, Rio key_custody) e Org T1B.
-- Nao altera nenhuma linha preexistente. IDs de usuarios vem do GoTrue local (t1_mkusers.mjs) e sao injetados em __UIDS__.
\set ON_ERROR_STOP on
begin;
create schema if not exists t1;
create table t1.u(k text primary key, id uuid not null);
insert into t1.u values __UIDS__;
create function t1.uid(text) returns uuid language sql stable as $$ select id from t1.u where k=$1 $$;
create function t1.orga() returns uuid language sql immutable as $$ select '7a000000-0000-0000-0000-00000000000a'::uuid $$;
create function t1.orgb() returns uuid language sql immutable as $$ select '7b000000-0000-0000-0000-00000000000b'::uuid $$;
create function t1.unit(text) returns uuid language sql immutable as $$ select (case $1 when 'sp' then '7a000000-0000-0000-0000-0000000000a1' when 'cp' then '7a000000-0000-0000-0000-0000000000a2' when 'rj' then '7a000000-0000-0000-0000-0000000000a3' when 'b' then '7b000000-0000-0000-0000-0000000000b1' end)::uuid $$;

insert into organizations(id,name) values (t1.orga(),'T1 Org A Ficticia'),(t1.orgb(),'T1 Org B Ficticia');
-- Org A: SEM linha em organization_settings (default ativo implicito). Org B: com linha default.
insert into organization_settings(organization_id) values (t1.orgb());
insert into fm_units(id,organization_id,name,workflow) values
 (t1.unit('sp'),t1.orga(),'T1 Sao Paulo','gate_visual'),(t1.unit('cp'),t1.orga(),'T1 Campinas','key_custody'),
 (t1.unit('rj'),t1.orga(),'T1 Rio','key_custody'),(t1.unit('b'),t1.orgb(),'T1 B Portaria','gate_visual');
insert into vehicle_locations(id,organization_id,name) values
 ('7a000000-0000-0000-0000-0000000000c1',t1.orga(),'T1 Garagem SP'),('7a000000-0000-0000-0000-0000000000c2',t1.orga(),'T1 Garagem CP'),
 ('7a000000-0000-0000-0000-0000000000c3',t1.orga(),'T1 Garagem RJ'),('7b000000-0000-0000-0000-0000000000c1',t1.orgb(),'T1 B Garagem');
insert into vehicle_categories(id,organization_id,name,passenger_capacity,supports_cargo,energy_type) values
 ('7a000000-0000-0000-0000-0000000000d1',t1.orga(),'T1 Sedan',5,false,'ICE'),('7a000000-0000-0000-0000-0000000000d2',t1.orga(),'T1 SUV',5,true,'ICE'),
 ('7b000000-0000-0000-0000-0000000000d1',t1.orgb(),'T1 B Sedan',5,false,'ICE');
insert into safety_equipment_items(organization_id,name) values (t1.orga(),'Extintor de Incendio'),(t1.orgb(),'Extintor de Incendio');

insert into profiles(id,organization_id,full_name,role,driver_authorized,drivers_license_number,drivers_license_category,drivers_license_expiration,drivers_license_expiration_source)
select t1.uid(k),o,'T1 '||k,r::user_role,auth,num,case when num is null then null else 'B' end,exp,case when exp is null then null else 'manual' end from (values
 ('t1admin',t1.orga(),'administrator',true,'71000000001',current_date+400),
 ('t1adminnocnh',t1.orga(),'administrator',false,null,null),
 ('t1fmall',t1.orga(),'fleet_manager',true,'71000000002',current_date+400),
 ('t1fmsp',t1.orga(),'fleet_manager',true,'71000000003',current_date+400),
 ('t1fmcp',t1.orga(),'fleet_manager',true,'71000000004',current_date+400),
 ('t1fmnocnh',t1.orga(),'fleet_manager',false,null,null),
 ('t1sec',t1.orga(),'security',false,null,null),
 ('t1maint',t1.orga(),'maintenance_operator',false,null,null),
 ('t1custcp',t1.orga(),'employee',true,'71000000005',current_date+400),
 ('t1custrj',t1.orga(),'employee',true,'71000000006',current_date+400),
 ('t1drvok',t1.orga(),'employee',true,'71000000007',current_date+400),
 ('t1drvexp',t1.orga(),'employee',true,'71000000008',current_date-10),
 ('t1drvnull',t1.orga(),'employee',true,null,null),
 ('t1emp',t1.orga(),'employee',false,null,null),
 ('t1deact',t1.orga(),'employee',true,'71000000009',current_date+400),
 ('t1req2',t1.orga(),'employee',true,'71000000010',current_date+400),
 ('t1adminb',t1.orgb(),'administrator',true,'72000000001',current_date+400),
 ('t1drvb',t1.orgb(),'employee',true,'72000000002',current_date+400),
 ('t1secb',t1.orgb(),'security',false,null,null)
) t(k,o,r,auth,num,exp);
insert into fm_manager_scopes(user_id,organization_id,mode,version,updated_by) values
 (t1.uid('t1fmall'),t1.orga(),'all_units',1,t1.uid('t1admin')),
 (t1.uid('t1fmnocnh'),t1.orga(),'all_units',1,t1.uid('t1admin')),
 (t1.uid('t1fmsp'),t1.orga(),'selected_units',1,t1.uid('t1admin')),
 (t1.uid('t1fmcp'),t1.orga(),'selected_units',1,t1.uid('t1admin'));
insert into fm_manager_scope_units(user_id,organization_id,unit_id,enabled) values
 (t1.uid('t1fmsp'),t1.orga(),t1.unit('sp'),true),(t1.uid('t1fmcp'),t1.orga(),t1.unit('cp'),true);
insert into fm_key_custodians(organization_id,unit_id,user_id,enabled,assigned_by) values
 (t1.orga(),t1.unit('cp'),t1.uid('t1custcp'),true,t1.uid('t1admin')),(t1.orga(),t1.unit('rj'),t1.uid('t1custrj'),true,t1.uid('t1admin'));
insert into fm_member_access(user_id,organization_id,enabled,version,reason,updated_by) values
 (t1.uid('t1deact'),t1.orga(),false,1,'T1 conta desativada para teste',t1.uid('t1admin'));

create table t1.v(k text primary key, id uuid not null, org uuid not null, unit uuid not null);
create function t1.vid(text) returns uuid language sql stable as $$ select id from t1.v where k=$1 $$;
create table t1.r(k text primary key, id uuid not null);
create function t1.rid(text) returns uuid language sql stable as $$ select id from t1.r where k=$1 $$;
create table t1.t(k text primary key, id uuid not null);
create function t1.tid(text) returns uuid language sql stable as $$ select id from t1.t where k=$1 $$;
create function t1.mkveh(p_k text, p_unit text) returns uuid language plpgsql as $$
declare v uuid:=gen_random_uuid(); o uuid:=case when p_unit='b' then t1.orgb() else t1.orga() end;
 loc uuid:=(case p_unit when 'sp' then '7a000000-0000-0000-0000-0000000000c1' when 'cp' then '7a000000-0000-0000-0000-0000000000c2' when 'rj' then '7a000000-0000-0000-0000-0000000000c3' else '7b000000-0000-0000-0000-0000000000c1' end)::uuid;
begin
 insert into t1.v(k,id,org,unit) values(p_k,v,o,t1.unit(p_unit));
 insert into vehicles(id,organization_id,plate,category_id,status,odometer_km,fuel_level_percent,estimated_range_km,next_service_odometer_km,home_location_id,current_location_id,has_blocking_damage,documentation_valid,is_clean_exterior,is_clean_interior,name,color)
 values(v,o,upper('T1'||replace(p_k,'_','')),case when o=t1.orgb() then '7b000000-0000-0000-0000-0000000000d1'::uuid else '7a000000-0000-0000-0000-0000000000d1'::uuid end,
  'available',10000,80,600,20000,loc,loc,false,true,true,true,'T1 '||p_k,'Cinza');
 insert into fm_vehicle_units(vehicle_id,organization_id,unit_id) values(v,o,t1.unit(p_unit));
 insert into fm_equipment_profiles(target_kind,target_id,organization_id,enabled,required_ids,optional_ids,version,updated_by)
 values('vehicle',v,o,true,array(select id from safety_equipment_items e where e.organization_id=o),'{}',1,case when o=t1.orgb() then t1.uid('t1adminb') else t1.uid('t1admin') end);
 return v;
end $$;
create function t1.mkres(p_k text, p_requester text, p_vehicle text, p_status reservation_status, p_start timestamptz, p_end timestamptz)
returns uuid language plpgsql as $$
declare t uuid; r uuid; o uuid:=(select organization_id from profiles where id=t1.uid(p_requester));
begin
 insert into trip_requests(organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,justification,allow_carpool)
 values(o,t1.uid(p_requester),p_start,p_end,'T1 origem','T1 destino',30,1,'T1 teste automatizado',false) returning id into t;
 insert into reservations(organization_id,vehicle_id,trip_request_id,status,start_at,end_at,approved_by,approved_at)
 values(o,t1.vid(p_vehicle),t,p_status,p_start,p_end,case when p_status='confirmed' then (select id from profiles where organization_id=o and role='administrator' order by full_name limit 1) end,case when p_status='confirmed' then now() end) returning id into r;
 insert into t1.r values(p_k,r) on conflict(k) do update set id=excluded.id;
 return r;
end $$;
-- executa SELECT escalar como usuario real (role authenticated + claims sub); erro vira texto
create function t1.as_user(uname text, q text) returns text language plpgsql as $$
declare r text; uid uuid:=t1.uid(uname);
begin
  perform set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated','aud','authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  set local role authenticated;
  begin
    execute q into r;
    reset role;
    return 'OK '||coalesce(r,'<null>');
  exception when others then
    reset role;
    return 'ERR '||sqlstate||' '||sqlerrm;
  end;
end $$;
commit;
select k,id from t1.u order by k;
