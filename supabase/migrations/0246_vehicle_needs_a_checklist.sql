-- A vehicle registered without checklist (equipment) items could not be picked up: the pickup screen only said "ask the manager to configure this vehicle".
-- Registering a vehicle now needs at least one checklist item, and the vehicle and its checklist are saved in the same transaction: with no item
-- (or an invalid one) nothing is saved at all.
create or replace function public.fm_management_create_vehicle_with_checklist(p_unit_id uuid, p_values jsonb, p_equipment_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if p_equipment_ids is null or cardinality(p_equipment_ids) = 0 or array_position(p_equipment_ids, null) is not null then
    raise exception 'CHECKLIST_REQUIRED';
  end if;
  v_id := public.fm_management_create_vehicle(p_unit_id, p_values);
  perform public.fm_equipment_profile_save('vehicle', v_id, p_equipment_ids, '{}'::uuid[], true, 0,
                                           'Checklist definido no cadastro do veículo', gen_random_uuid());
  return v_id;
end;
$$;
revoke all on function public.fm_management_create_vehicle_with_checklist(uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.fm_management_create_vehicle_with_checklist(uuid, jsonb, uuid[]) to authenticated;
