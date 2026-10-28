-- Rollback of 0233 (WhatsApp notice to the requester after the manager's decision).
drop function if exists public.fm_requester_notice(uuid);
