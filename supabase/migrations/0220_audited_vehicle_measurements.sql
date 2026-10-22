-- Preserve the existing edit form, but audit measurements and require an explicit odometer correction reason.
-- Direct grants are contracted separately in 0223, after app deployment.
create function public.fm_update_vehicle(p_id uuid,p_payload jsonb,p_correction_reason text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare a vehicles%rowtype;b vehicles%rowtype;
begin
 if not fm_account_enabled() or current_user_role() not in ('fleet_manager','administrator') or not coalesce(fm_can_manage_vehicle(p_id),false) then raise exception 'MANAGEMENT_SCOPE_DENIED';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('plate','category_id','odometer_km','next_service_odometer_km','estimated_range_km','fuel_level_percent','battery_level_percent','home_location_id','name','color')) then raise exception 'INVALID_INPUT';end if;
 select * into a from vehicles where id=p_id and organization_id=current_organization_id() for update;
 if not found then raise exception 'NOT_FOUND';end if;
 b:=jsonb_populate_record(a,p_payload);
 if b.odometer_km is null or b.odometer_km<0 or b.fuel_level_percent not between 0 and 100 or b.battery_level_percent not between 0 and 100 or b.estimated_range_km<0 or (b.next_service_odometer_km is not null and b.next_service_odometer_km<b.odometer_km) then raise exception 'INVALID_INPUT';end if;
 if b.odometer_km<a.odometer_km and (p_correction_reason is null or length(trim(p_correction_reason)) not between 3 and 1000) then raise exception 'ODOMETER_CORRECTION_REASON_REQUIRED';end if;
 if not exists(select 1 from vehicle_categories where id=b.category_id and organization_id=a.organization_id) or (b.home_location_id is not null and not exists(select 1 from vehicle_locations where id=b.home_location_id and organization_id=a.organization_id)) then raise exception 'INVALID_INPUT';end if;
 update vehicles set plate=b.plate,category_id=b.category_id,odometer_km=b.odometer_km,next_service_odometer_km=b.next_service_odometer_km,estimated_range_km=b.estimated_range_km,fuel_level_percent=b.fuel_level_percent,battery_level_percent=b.battery_level_percent,home_location_id=b.home_location_id,name=b.name,color=b.color,updated_at=now() where id=p_id;
 perform log_audit_event(a.organization_id,auth.uid(),'vehicle.measurements_updated','vehicle',p_id,
 jsonb_build_object('odometer_km',a.odometer_km,'fuel_level_percent',a.fuel_level_percent,'battery_level_percent',a.battery_level_percent,'estimated_range_km',a.estimated_range_km),
 jsonb_build_object('odometer_km',b.odometer_km,'fuel_level_percent',b.fuel_level_percent,'battery_level_percent',b.battery_level_percent,'estimated_range_km',b.estimated_range_km,'correction_reason',p_correction_reason));
end;$$;
revoke all on function public.fm_update_vehicle(uuid,jsonb,text) from public,anon;
grant execute on function public.fm_update_vehicle(uuid,jsonb,text) to authenticated;
