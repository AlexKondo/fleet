-- Performance-only migration: no schema/behaviour change, indexes only.
--
-- Every index below is justified against a query actually built in apps/web (file:line
-- cited per index). Nothing speculative: columns that are already covered by an existing
-- index (vehicles(organization_id, status) from 0001, workflow_tasks(vehicle_id, status)
-- from 0002, notifications(user_id, created_at desc) from 0008, reservation_messages
-- (reservation_id, created_at) from 0017, audit_log(organization_id, created_at desc)
-- from 0015, trip_participants unique(trip_request_id, passenger_id) from 0002) are NOT
-- re-indexed here.
--
-- Every composite index leads with organization_id, because RLS adds
-- `organization_id = current_organization_id()` to literally every query on these tables
-- (0001_init_schema.sql:183+), so the tenant predicate is always present and always the
-- most selective leading column available.
--
-- `if not exists` + plain (non-concurrent) `create index`: no existing migration in
-- 0001..0030 uses CREATE INDEX CONCURRENTLY, and Supabase's migration runner wraps each
-- file in a transaction, where CONCURRENTLY is not allowed. Matching existing convention.

-- ---------------------------------------------------------------------------
-- reservations — the hottest table in the app
-- ---------------------------------------------------------------------------

-- Serves the two "status + chronological list" reads:
--   apps/web/app/dashboard/page.tsx:105-112  .eq("status","pending_approval").order("start_at")
--   apps/web/app/gate/page.tsx:55-62         .eq("status","confirmed").order("start_at")
--   apps/web/app/dashboard/page.tsx:140-147  .in("status",[pending_approval,confirmed]).order("start_at")
-- Today only reservations(organization_id) and reservations(vehicle_id) exist (0001:167-168),
-- so each of these is an org-wide scan + filter + sort. With this index each becomes a
-- range scan already in start_at order, and the LIMIT 50/100 can stop early.
create index if not exists reservations_org_status_start_at_idx
  on reservations (organization_id, status, start_at);

-- Serves the availability / candidate-vehicle scan on the booking hot path:
--   apps/web/app/trips/new/actions.ts:93-100  .in("status",[pending_approval,confirmed]).gt("end_at", now)
-- The predicate is written out as the literal status list rather than reusing the stored
-- generated column active_status (0001:163). They are semantically identical, but the
-- planner's predicate prover cannot see through a generated column: it would not be able
-- to prove that the query's `status in ('pending_approval','confirmed')` implies
-- `active_status`, and the index would simply never be used. Spelled this way it matches
-- the incoming qual directly. The index therefore only holds live reservations and stays
-- small forever while cancelled/completed history grows.
create index if not exists reservations_active_org_end_at_idx
  on reservations (organization_id, end_at)
  where status in ('pending_approval', 'confirmed');

-- reservations.trip_request_id is a FK (0001:152) with no index — Postgres does not index
-- FK columns automatically. Serves:
--   apps/web/app/trips/page.tsx:58-64  .in("trip_request_id", carpoolTripRequestIds)
-- and every PostgREST embed of `trip_request:trip_requests(...)`, plus the referential-
-- integrity check on any trip_requests delete/update.
create index if not exists reservations_trip_request_id_idx
  on reservations (trip_request_id);

-- ---------------------------------------------------------------------------
-- trip_requests
-- ---------------------------------------------------------------------------

-- Serves "my trips", which filters reservations through an inner-joined trip_requests:
--   apps/web/app/trips/page.tsx:33-40  .eq("trip_request.requester_id", user.id) with !inner
-- and, more importantly, the per-row correlated EXISTS inside the reservation_messages
-- SELECT policy (0017_communication_hub.sql:51-56), which joins reservations -> trip_requests
-- and tests tr.requester_id = auth.uid() for every candidate message row. Only
-- trip_requests(organization_id) exists today (0001:139).
create index if not exists trip_requests_org_requester_id_idx
  on trip_requests (organization_id, requester_id);

-- ---------------------------------------------------------------------------
-- workflow_tasks
-- ---------------------------------------------------------------------------

-- Serves the operator task queue:
--   apps/web/app/dashboard/page.tsx:121-131  .eq("status","open")[.or(assigned_to...)].order("created_at").limit(50)
-- Existing indexes are workflow_tasks(organization_id) and (vehicle_id, status) (0002:96-97);
-- neither can satisfy org + status + created_at ordering. Partial on status='open' keeps it
-- tiny: done/cancelled tasks accumulate forever and are never read by this query.
-- The optional `or(assigned_to.eq.X, assigned_to.is.null)` branch then filters a
-- pre-narrowed, already-ordered 50-row window (workflow_tasks_assigned_to_idx from 0030
-- remains available for the assigned_to lookup side).
create index if not exists workflow_tasks_org_open_created_at_idx
  on workflow_tasks (organization_id, created_at)
  where status = 'open';

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------

-- The unread badge runs on every authenticated page render:
--   apps/web/app/dashboard/NotificationBell.tsx:155  select("id",{count:"exact",head:true}).is("read_at", null)
--   apps/web/app/dashboard/notificationActions.ts:36  update(...).is("read_at", null)
-- notifications(user_id, read_at) (0008:20) does work here, but it indexes every row a user
-- has ever received, and an exact count must visit each matching entry. A partial index on
-- unread-only rows is bounded by the unread backlog (normally near zero) instead of by
-- lifetime notification volume, so the count becomes an index-only scan over a handful of
-- entries. The existing 0008 indexes are kept (the ordered list query at
-- NotificationBell.tsx:151-153 still uses notifications(user_id, created_at desc)).
create index if not exists notifications_unread_user_id_idx
  on notifications (user_id)
  where read_at is null;

-- ---------------------------------------------------------------------------
-- trip_participants
-- ---------------------------------------------------------------------------

-- Serves "carpools I joined":
--   apps/web/app/trips/page.tsx:49-52  .eq("passenger_id", user.id).order("joined_at", desc)
-- The unique constraint from 0002:26 is (trip_request_id, passenger_id) — passenger_id is
-- the trailing column, so it cannot serve a passenger_id-leading lookup. Only
-- trip_participants(organization_id) (0002:29) exists otherwise, so this is currently an
-- org-wide scan + sort on a page every employee opens.
create index if not exists trip_participants_passenger_joined_at_idx
  on trip_participants (passenger_id, joined_at desc);
