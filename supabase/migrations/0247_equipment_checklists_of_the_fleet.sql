-- The edit form of a vehicle shows its checklist items (ticked = checked at pickup and return). One call gives, for every vehicle the caller manages,
-- the items of its effective checklist (its own, else its model's) and the version of its own profile (0 = none yet), for the save with fm_equipment_profile_save.
create or replace function public.fm_equipment_checklists()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if current_organization_id() is null or current_user_role() not in ('fleet_manager', 'administrator') then raise exception 'NOT_AUTHORIZED'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'vehicle_id', v.id,
             'required_ids', to_jsonb(coalesce(p.required_ids, '{}'::uuid[])),
             'optional_ids', to_jsonb(coalesce(p.optional_ids, '{}'::uuid[])),
             'version', coalesce(vp.version, 0)))
      from public.vehicles v
      left join lateral (
        select x.* from public.fm_equipment_profiles x
         where x.organization_id = v.organization_id and x.enabled
           and ((x.target_kind = 'vehicle' and x.target_id = v.id) or (x.target_kind = 'category' and x.target_id = v.category_id))
         order by (x.target_kind = 'vehicle') desc limit 1) p on true
      left join public.fm_equipment_profiles vp on vp.target_kind = 'vehicle' and vp.target_id = v.id
     where v.organization_id = current_organization_id() and public.fm_can_manage_vehicle(v.id)
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.fm_equipment_checklists() from public, anon;
grant execute on function public.fm_equipment_checklists() to authenticated;
