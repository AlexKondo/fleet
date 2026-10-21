-- Rollback of 0209: removes the automatic release function. Reservations already released stay cancelled
-- (cancellation_reason no_show_auto / expired_unapproved, audit action reservation.no_show_released) — that history is kept.
-- Apply before rollback/0207_rollback.sql. The cron route /api/cron/reservation-expiry then answers 500 until the app is reverted too.
drop function if exists public.fm_release_expired_reservations(uuid, integer);
