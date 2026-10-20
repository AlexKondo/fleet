create function public.fm_management_unit_dimension() returns jsonb language plpgsql stable security definer set search_path=public, pg_temp as $$
declare v_org uuid:=current_organization_id();begin
 if v_org is null or current_user_role() not in ('fleet_manager','administrator') then raise exception 'NOT_AUTHORIZED';end if;
 return jsonb_build_object('units',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'enabled',u.enabled) order by u.name,u.id) from fm_units u where u.organization_id=v_org and fm_can_manage_unit(u.id)),'[]'::jsonb),
 'bindings',coalesce((select jsonb_agg(jsonb_build_object('vehicle_id',m.vehicle_id,'unit_id',u.id) order by m.vehicle_id) from fm_vehicle_units m join fm_units u on u.id=m.unit_id and u.organization_id=m.organization_id where m.organization_id=v_org and fm_can_manage_vehicle(m.vehicle_id) and fm_can_manage_unit(u.id)),'[]'::jsonb));
end;$$;
-- A subject-only structured export. No actor/organization parameter or third-party directory.
create function public.fm_export_my_data() returns jsonb language plpgsql security definer set search_path=public, pg_temp as $$
declare v_actor uuid:=auth.uid();v_org uuid:=current_organization_id();v_result jsonb;begin
 if v_actor is null or v_org is null or not fm_account_enabled() then raise exception 'NOT_AUTHORIZED';end if;
 v_result:=jsonb_build_object('schema','fleetmind.personal-data.v1','generated_at',now(),'subject_id',v_actor,
 'profile',(select jsonb_build_object('id',p.id,'full_name',p.full_name,'role',p.role,'created_at',p.created_at,'avatar_url',p.avatar_url,'drivers_license_number',p.drivers_license_number,'drivers_license_category',p.drivers_license_category,'drivers_license_expiration',p.drivers_license_expiration,'driver_authorized',p.driver_authorized) from profiles p where p.id=v_actor and p.organization_id=v_org),
 'email',(select email from auth.users where id=v_actor),
 'trips',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at,t.id) from trip_requests t where t.organization_id=v_org and t.requester_id=v_actor),'[]'::jsonb),
 'reservations',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at,r.id) from reservations r join trip_requests t on t.id=r.trip_request_id where r.organization_id=v_org and t.requester_id=v_actor),'[]'::jsonb),
 'carpool_offers',coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at,o.id) from carpool_offers o where o.organization_id=v_org and o.host_id=v_actor),'[]'::jsonb),
 'ride_requests',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at,q.id) from carpool_ride_requests q where q.organization_id=v_org and q.rider_id=v_actor),'[]'::jsonb),
 'participations',coalesce((select jsonb_agg(to_jsonb(p) order by p.joined_at,p.id) from trip_participants p where p.organization_id=v_org and p.passenger_id=v_actor),'[]'::jsonb),
 'inspections',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at,i.id) from inspections i where i.organization_id=v_org and i.performed_by=v_actor),'[]'::jsonb),
 'messages_sent',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at,m.id) from reservation_messages m where m.organization_id=v_org and m.sender_id=v_actor),'[]'::jsonb),
 'notifications',coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at,n.id) from notifications n where n.organization_id=v_org and n.user_id=v_actor),'[]'::jsonb),
 'conversations',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'status',c.status,'created_at',c.created_at,'updated_at',c.updated_at,'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'role',m.role,'content',m.content,'intent',m.intent,'created_at',m.created_at) order by m.created_at,m.id) from chat_messages m where m.conversation_id=c.id),'[]'::jsonb)) order by c.created_at,c.id) from chat_conversations c where c.organization_id=v_org and c.user_id=v_actor),'[]'::jsonb),
 'privacy_requests',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at,p.id) from fm_privacy_requests p where p.organization_id=v_org and p.subject_id=v_actor),'[]'::jsonb),
 'account_access_history',coalesce((select jsonb_agg(jsonb_build_object('enabled',h.enabled,'version',h.version,'reason',h.reason,'created_at',h.created_at) order by h.created_at,h.id) from fm_member_access_history h where h.organization_id=v_org and h.user_id=v_actor),'[]'::jsonb),
 'scope',jsonb_build_object('format','structured_json','binary_files_included',false,'third_party_profiles_included',false));
 perform log_audit_event(v_org,v_actor,'privacy.self_export','profile',v_actor,null,jsonb_build_object('schema','fleetmind.personal-data.v1'));
 return v_result;
end;$$;
revoke all on function public.fm_management_unit_dimension(),public.fm_export_my_data() from public,anon;
grant execute on function public.fm_management_unit_dimension(),public.fm_export_my_data() to authenticated;
