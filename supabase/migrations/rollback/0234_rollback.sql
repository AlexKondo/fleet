-- Rollback of 0234 (WhatsApp notice to the host when somebody takes a carpool).
drop function if exists public.fm_carpool_notice(uuid);
