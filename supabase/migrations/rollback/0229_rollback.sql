-- Rollback of 0229 (manager approval by WhatsApp / e-mail). Drops only what 0229 created; no existing object is touched.
-- Pending approval requests are lost; reservations stay as they are (they can still be approved in the app).
drop function if exists public.fm_approval_notify_manager(uuid);
drop function if exists public.fm_manager_decide_reservation(uuid, text);
drop function if exists public.fm_manager_pending_approvals();
drop function if exists public.fm_has_direct_reports();
drop function if exists public.fm_approval_expire_due();
drop function if exists public.fm_approval_decide(text, text, text, text, text);
drop function if exists public.fm_approval_peek(text);
drop function if exists public.fm_approval_mark_delivery(uuid, boolean, text);
drop function if exists public.fm_approval_prepare(uuid, boolean, integer, text[]);
drop function if exists public.fm_channel_reject(uuid, uuid, text);
drop function if exists public.fm_channel_approve(uuid, uuid, text);
drop function if exists public.fm_approval_channel_snapshot();
drop function if exists public.fm_set_whatsapp_contact(uuid, text, boolean);
drop function if exists public.fm_set_user_manager(uuid, uuid);
drop function if exists public.fm_phone_digits_norm(text);
drop table if exists public.fm_approval_requests;
drop table if exists public.fm_whatsapp_contacts;
drop table if exists public.fm_user_managers;
