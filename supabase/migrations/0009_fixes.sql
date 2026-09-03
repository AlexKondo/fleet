-- Two real bugs found by independent code review of the previous round, both confirmed
-- before fixing:

-- 1. 0006_vehicle_location_tracking.sql's `create or replace function record_return(...)`
--    added a 13th parameter (p_current_location_id). Postgres identifies a function by
--    name AND parameter signature, so a changed signature creates an ADDITIONAL
--    function rather than replacing 0004_operational_actions.sql's original 12-arg one
--    — that stale overload is still live and still GRANTed to authenticated, with none
--    of 0006's location validation or 0008's notification insert. Any caller (a stale
--    client, a direct PostgREST call) that omits p_current_location_id would silently
--    resolve to the old, incomplete overload instead of erroring. Drop it explicitly —
--    `create or replace` can never do this for a signature change, only an exact match.
drop function if exists record_return(
  uuid, integer, numeric, numeric, boolean, text, text[], boolean, boolean, inspection_role,
  text, workflow_task_type[]
);

-- 2. signUpOrganization (apps/web/lib/domain/signUpOrganization.ts) creates an
-- organization + organization_settings + the founder's profile, but no
-- vehicle_locations row — and the return checklist's location picker
-- (ReturnForm.tsx) is a required <select> with no UI anywhere to create one. A
-- brand-new organization could never complete a single vehicle return: the form
-- would forever show only the disabled "Selecione um local" placeholder. Fixed at the
-- application layer instead of here — signUpOrganization already uses the service-role
-- admin client (RLS-bypassing by design, since there is no tenant context yet to scope
-- a normal client to), so it can insert the starter vehicle_locations row directly
-- alongside organization_settings without needing a dedicated RPC.
