-- ACL kept exactly as before (create or replace preserves it; restated explicitly).
revoke all on function public.fm_release_damage_hold(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fm_release_damage_hold(uuid, text, uuid, uuid) to service_role;
revoke all on function public.fm_release_expired_reservations(uuid, integer) from public, anon, authenticated;
grant execute on function public.fm_release_expired_reservations(uuid, integer) to service_role;
revoke all on function public.complete_workflow_task(uuid) from public, anon;
grant execute on function public.complete_workflow_task(uuid) to authenticated, service_role;
revoke all on function public.cancel_workflow_task(uuid) from public, anon;
grant execute on function public.cancel_workflow_task(uuid) to authenticated, service_role;
revoke all on function public.cancel_reservation(uuid, text) from public, anon;
grant execute on function public.cancel_reservation(uuid, text) to authenticated, service_role;
revoke all on function public.fm_key_command(uuid, text, text, uuid) from public, anon;
grant execute on function public.fm_key_command(uuid, text, text, uuid) to authenticated, service_role;
revoke all on function public.record_pickup(uuid, integer, numeric, numeric, boolean, text, text[], boolean, boolean, public.inspection_role) from public, anon;
grant execute on function public.record_pickup(uuid, integer, numeric, numeric, boolean, text, text[], boolean, boolean, public.inspection_role) to authenticated, service_role;
