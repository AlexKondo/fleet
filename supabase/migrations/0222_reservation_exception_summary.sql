-- Expose only the outcome to the requester, never the internal exception reason.
create function public.fm_not_departed_reservations(p_ids uuid[]) returns uuid[] language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(array_agg(distinct e.reservation_id),'{}'::uuid[]) from fm_operation_exceptions e
 join reservations r on r.id=e.reservation_id and r.organization_id=e.organization_id join trip_requests t on t.id=r.trip_request_id and t.organization_id=r.organization_id
 where fm_account_enabled() and e.organization_id=current_organization_id() and e.outcome='not_departed' and e.reservation_id=any(p_ids)
 and (t.requester_id=auth.uid() or current_user_role()='security' or (current_user_role() in ('fleet_manager','administrator') and fm_can_manage_reservation(r.id)));
$$;
revoke all on function public.fm_not_departed_reservations(uuid[]) from public,anon;
grant execute on function public.fm_not_departed_reservations(uuid[]) to authenticated;
