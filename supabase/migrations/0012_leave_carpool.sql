-- CRUD completion: trip_participants had insert + select RLS policies
-- (0002_operational_cycle.sql) but no delete policy at all — once someone joined a
-- carpool via create_carpool_participation (0003_trip_request_flow.sql), there was
-- literally no way, in the app or via a direct authenticated request, to leave it again.
-- A plain policy is enough here (unlike cancel_reservation): leaving only ever removes
-- the caller's own row and has no side effects on vehicle status or the driver's
-- reservation, so there's no shared state to re-derive the way cancelling a reservation
-- requires.
create policy "members leave trips they joined" on trip_participants
  for delete using (
    organization_id = current_organization_id()
    and passenger_id = auth.uid()
  );
