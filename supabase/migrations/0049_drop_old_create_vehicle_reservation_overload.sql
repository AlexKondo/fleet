-- 0047_carpool_consent_and_tolerance.sql added `p_allow_carpool` to
-- create_vehicle_reservation via CREATE OR REPLACE, but a new parameter changes the
-- function's signature — Postgres treated it as a second, distinct overload instead of
-- replacing the original, so both the 9-arg and 10-arg versions existed at once. A caller
-- that invokes the RPC without p_allow_carpool (relying on its DEFAULT true) matches both
-- overloads and PostgREST/Postgres can't pick one ("function is not unique"), which is
-- exactly what the chat assistant's dispatch.ts call does — every chat-created reservation
-- was failing with an opaque, unmapped error. Drops the old 9-arg overload so only the
-- p_allow_carpool-aware one remains.
drop function if exists public.create_vehicle_reservation(
  timestamp with time zone, timestamp with time zone, text, text, numeric, integer, boolean, text, uuid
);
