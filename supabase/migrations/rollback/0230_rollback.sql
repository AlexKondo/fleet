-- Rollback of 0230 (reserving by WhatsApp). Drops only what 0230 created.
drop function if exists public.fm_whatsapp_session_open(uuid, integer);
drop function if exists public.fm_whatsapp_register_inbound(text, uuid, uuid, text, boolean);
drop function if exists public.fm_whatsapp_identify(text);
drop table if exists public.fm_whatsapp_inbound;
