-- FleetMind P01D | DRAFT / NOT APPROVED FOR EXECUTION
-- Derived from read-only production catalog snapshot 2026-10-19.
-- Apply ONLY after isolated staging restoration, owner/grants/behavior regression and explicit approval.
-- Only reverses P01D changes, not other independent changes.
-- Requires matching P01D post-state; aborts if drift detected.
BEGIN;
DO $p01d_rollback$
DECLARE item record; oid_value oid; actual_path text; actual_owner name; is_definer boolean;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('accept_carpool_ride_request(uuid)'::text, 'search_path=public'::text),
    ('auto_reassign_reservation_vehicle(uuid,uuid,uuid)'::text, 'search_path=public'::text),
    ('cancel_carpool_ride_request(uuid)'::text, 'search_path=public'::text),
    ('cancel_reservation(uuid,text)'::text, 'search_path=public'::text),
    ('carpool_apply_accept(uuid,uuid,boolean)'::text, 'search_path=public'::text),
    ('carpool_emit_event(uuid,text,uuid,uuid,uuid,uuid,jsonb)'::text, 'search_path=public'::text),
    ('carpool_events_notify()'::text, 'search_path=public'::text),
    ('carpool_host_trip_is_active(uuid)'::text, 'search_path=public'::text),
    ('carpool_invalidate_request(uuid,text,uuid)'::text, 'search_path=public'::text),
    ('carpool_notify_user(uuid,uuid,text,text,uuid,boolean)'::text, 'search_path=public'::text),
    ('carpool_policy_for_org(uuid)'::text, 'search_path=public'::text),
    ('carpool_recompute_seats(uuid)'::text, 'search_path=public'::text),
    ('carpool_reservation_cancelled()'::text, 'search_path=public'::text),
    ('carpool_revalidate_trip(uuid,uuid,text[])'::text, 'search_path=public'::text),
    ('carpool_seats_taken(uuid)'::text, 'search_path=public'::text),
    ('carpool_trip_requests_changed()'::text, 'search_path=public'::text),
    ('carpool_vehicle_free_seats(uuid)'::text, 'search_path=public'::text),
    ('create_carpool_ride_request_as_rider(uuid,uuid,integer,jsonb,jsonb,timestamp with time zone,uuid,numeric,numeric)'::text, 'search_path=public'::text),
    ('current_organization_id()'::text, 'search_path=public'::text),
    ('current_user_role()'::text, 'search_path=public'::text),
    ('disable_carpool_offer(uuid)'::text, 'search_path=public'::text),
    ('enable_carpool_offer(uuid,integer)'::text, 'search_path=public'::text),
    ('expire_stale_carpool_requests()'::text, 'search_path=public'::text),
    ('get_my_license()'::text, 'search_path=public'::text),
    ('get_vehicle_busy_windows(timestamp with time zone)'::text, 'search_path=public'::text),
    ('host_ride_request_places(uuid)'::text, 'search_path=public'::text),
    ('increment_geo_provider_quota_counter(uuid,text,date)'::text, 'search_path=public'::text),
    ('list_member_license_sources()'::text, 'search_path=public'::text),
    ('list_member_licenses()'::text, 'search_path=public'::text),
    ('lock_and_require_multiple_administrators(uuid)'::text, 'search_path=public'::text),
    ('log_audit_event(uuid,uuid,text,text,uuid,jsonb,jsonb)'::text, 'search_path=public'::text),
    ('post_reservation_message(uuid,message_type,text,timestamp with time zone)'::text, 'search_path=public'::text),
    ('record_geo_provider_call_outcome(uuid,text,date,boolean,integer)'::text, 'search_path=public'::text),
    ('record_pickup(uuid,integer,numeric,numeric,boolean,text,text[],boolean,boolean,inspection_role)'::text, 'search_path=public'::text),
    ('record_return(uuid,integer,numeric,numeric,boolean,text,text[],boolean,boolean,inspection_role,text,workflow_task_type[],uuid)'::text, 'search_path=public'::text),
    ('reject_carpool_ride_request(uuid,text)'::text, 'search_path=public'::text),
    ('respond_to_carpool_request(uuid,boolean)'::text, 'search_path=public'::text),
    ('revalidate_carpool_matches(uuid)'::text, 'search_path=public'::text),
    ('rls_hosted_trip_request_ids()'::text, 'search_path=public'::text),
    ('rls_notifiable_user_ids()'::text, 'search_path=public'::text),
    ('rls_related_profile_ids()'::text, 'search_path=public'::text),
    ('rls_requested_offer_ids()'::text, 'search_path=public'::text),
    ('rls_visible_trip_request_ids()'::text, 'search_path=public'::text),
    ('update_carpool_offer(uuid,integer)'::text, 'search_path=public'::text),
    ('update_member_role(uuid,uuid,user_role)'::text, 'search_path=public'::text)
  ) AS expected(signature, original_setting) LOOP
    SELECT to_regprocedure('public.' || item.signature)::oid INTO oid_value;
    IF oid_value IS NULL THEN RAISE EXCEPTION 'P01D rollback: missing %', item.signature; END IF;
    SELECT array_to_string(p.proconfig, ', '), pg_get_userbyid(p.proowner), p.prosecdef
      INTO actual_path, actual_owner, is_definer FROM pg_proc p WHERE p.oid=oid_value;
    IF actual_path IS DISTINCT FROM 'search_path=public, pg_temp' OR actual_owner <> 'postgres' OR NOT is_definer THEN
      RAISE EXCEPTION 'P01D rollback: unexpected state for %: %', item.signature, actual_path;
    END IF;
  END LOOP;
  FOR item IN SELECT * FROM (VALUES
    ('accept_carpool_ride_request(uuid)'::text, 'search_path=public'::text),
    ('auto_reassign_reservation_vehicle(uuid,uuid,uuid)'::text, 'search_path=public'::text),
    ('cancel_carpool_ride_request(uuid)'::text, 'search_path=public'::text),
    ('cancel_reservation(uuid,text)'::text, 'search_path=public'::text),
    ('carpool_apply_accept(uuid,uuid,boolean)'::text, 'search_path=public'::text),
    ('carpool_emit_event(uuid,text,uuid,uuid,uuid,uuid,jsonb)'::text, 'search_path=public'::text),
    ('carpool_events_notify()'::text, 'search_path=public'::text),
    ('carpool_host_trip_is_active(uuid)'::text, 'search_path=public'::text),
    ('carpool_invalidate_request(uuid,text,uuid)'::text, 'search_path=public'::text),
    ('carpool_notify_user(uuid,uuid,text,text,uuid,boolean)'::text, 'search_path=public'::text),
    ('carpool_policy_for_org(uuid)'::text, 'search_path=public'::text),
    ('carpool_recompute_seats(uuid)'::text, 'search_path=public'::text),
    ('carpool_reservation_cancelled()'::text, 'search_path=public'::text),
    ('carpool_revalidate_trip(uuid,uuid,text[])'::text, 'search_path=public'::text),
    ('carpool_seats_taken(uuid)'::text, 'search_path=public'::text),
    ('carpool_trip_requests_changed()'::text, 'search_path=public'::text),
    ('carpool_vehicle_free_seats(uuid)'::text, 'search_path=public'::text),
    ('create_carpool_ride_request_as_rider(uuid,uuid,integer,jsonb,jsonb,timestamp with time zone,uuid,numeric,numeric)'::text, 'search_path=public'::text),
    ('current_organization_id()'::text, 'search_path=public'::text),
    ('current_user_role()'::text, 'search_path=public'::text),
    ('disable_carpool_offer(uuid)'::text, 'search_path=public'::text),
    ('enable_carpool_offer(uuid,integer)'::text, 'search_path=public'::text),
    ('expire_stale_carpool_requests()'::text, 'search_path=public'::text),
    ('get_my_license()'::text, 'search_path=public'::text),
    ('get_vehicle_busy_windows(timestamp with time zone)'::text, 'search_path=public'::text),
    ('host_ride_request_places(uuid)'::text, 'search_path=public'::text),
    ('increment_geo_provider_quota_counter(uuid,text,date)'::text, 'search_path=public'::text),
    ('list_member_license_sources()'::text, 'search_path=public'::text),
    ('list_member_licenses()'::text, 'search_path=public'::text),
    ('lock_and_require_multiple_administrators(uuid)'::text, 'search_path=public'::text),
    ('log_audit_event(uuid,uuid,text,text,uuid,jsonb,jsonb)'::text, 'search_path=public'::text),
    ('post_reservation_message(uuid,message_type,text,timestamp with time zone)'::text, 'search_path=public'::text),
    ('record_geo_provider_call_outcome(uuid,text,date,boolean,integer)'::text, 'search_path=public'::text),
    ('record_pickup(uuid,integer,numeric,numeric,boolean,text,text[],boolean,boolean,inspection_role)'::text, 'search_path=public'::text),
    ('record_return(uuid,integer,numeric,numeric,boolean,text,text[],boolean,boolean,inspection_role,text,workflow_task_type[],uuid)'::text, 'search_path=public'::text),
    ('reject_carpool_ride_request(uuid,text)'::text, 'search_path=public'::text),
    ('respond_to_carpool_request(uuid,boolean)'::text, 'search_path=public'::text),
    ('revalidate_carpool_matches(uuid)'::text, 'search_path=public'::text),
    ('rls_hosted_trip_request_ids()'::text, 'search_path=public'::text),
    ('rls_notifiable_user_ids()'::text, 'search_path=public'::text),
    ('rls_related_profile_ids()'::text, 'search_path=public'::text),
    ('rls_requested_offer_ids()'::text, 'search_path=public'::text),
    ('rls_visible_trip_request_ids()'::text, 'search_path=public'::text),
    ('update_carpool_offer(uuid,integer)'::text, 'search_path=public'::text),
    ('update_member_role(uuid,uuid,user_role)'::text, 'search_path=public'::text)
  ) AS expected(signature, original_setting) LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public',
      ('public.' || item.signature)::regprocedure);
  END LOOP;
END
$p01d_rollback$;
COMMIT;
