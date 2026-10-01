-- PENDING migration (TIGHTENING) - apply ONLY after the app containing Phase C7b is deployed AND
-- 0065 (additive: rls_notifiable_user_ids) is applied. Rollback: supabase/migrations-pending/rollback/0067_rollback.sql.
--
-- M2 (C7a audit, Medium): the notifications INSERT policy only checked organization_id, so ANY employee JWT
-- could insert notifications addressed to coworkers or administrators with arbitrary title/body/link
-- (spoofing / phishing vector inside the bell).
--
-- THREAT MODEL (every insert site, enumerated from supabase/migrations + the live pg_proc sources + apps/web):
--   SECURITY INVOKER SQL (run with the caller's JWT, subject to this policy):
--     create_vehicle_reservation   employee  -> every fleet_manager/administrator   ("Nova reserva aguardando aprovação")
--     create_carpool_participation employee  -> host of the trip joined (legacy)     ("Pedido de carona na sua viagem")
--     approve_reservation          manager   -> the requester
--     block_vehicle                manager   -> every manager/administrator
--   SECURITY DEFINER SQL (insert as the function owner; RLS and this policy do not apply; auth.uid() is still the caller):
--     cancel_reservation, post_reservation_message, record_return, respond_to_carpool_request,
--     carpool_notify_user (+ carpool_events_notify trigger: all carpool lifecycle notifications)
--   APP CODE: apps/web/lib/domain/autoReassignment.ts inserted with the USER client for OTHER requesters
--     (delay auto-reassignment) -> converted in this phase to the service-role (admin) client, scoped to the
--     organization of the already-authenticated caller, fixed server-side text. Nothing else in apps/web
--     inserts into notifications (license reminders are e-mail only; notificationActions only UPDATEs read_at).
--
-- DESIGN (adopted, policy + exact-template guard):
--   (1) POLICY - a direct insert is allowed only when
--         user_id = auth.uid()                                   (a note to oneself), or
--         the caller is staff: fleet_manager / administrator / security / maintenance_operator, or
--         the target is a fleet_manager/administrator of the same org, or the host of a trip the caller
--         participates in (rls_notifiable_user_ids(), 0065).
--       => employee -> employee spoofing is impossible; employee -> unrelated user is impossible.
--   (2) TRIGGER GUARD - for a direct (non-definer) insert by someone who is neither the target nor staff, the row must be
--       EXACTLY one of the two messages the invoker functions create, title AND body template:
--         'Nova reserva aguardando aprovação'  / 'Uma nova viagem para <destination> aguarda aprovação.'      (create_vehicle_reservation)
--         'Pedido de carona na sua viagem'     / 'Alguém pediu para participar da sua viagem para <destination>. Acesse os
--                                                 detalhes da reserva para aceitar ou recusar.'                (create_carpool_participation)
--       with entity_type / entity_id NULL (no forged deep link) and a body of at most 1000 chars. (The cap is 1000, not
--       500, so the DEPLOYED code - which does not clamp the destination - cannot make create_vehicle_reservation fail
--       for a long destination; the app now clamps destinations to 300 chars.)
--       Definer functions / service role are not affected: inside them current_user is the owner role, not
--       `authenticated`.
-- RESIDUAL RISK (accepted, very low): the <destination> placeholder is attacker-controlled text inside the fixed frame
-- (the same text the employee legitimately types as a trip destination). No free-text message, link or other title
-- can be sent; staff roles (manager, administrator, security, maintenance) can notify anyone by design.
--
-- Backward compatible with the deployed code (86dc094): every legitimate flow above keeps working (proved by
-- supabase/tests/preflight-role-simulation.mjs). The ONLY deployed-code behaviour that stops working is the
-- delay auto-reassignment follow-up notification written with the user client (its insert error was ignored by
-- the code, so the notification would be lost silently) - the new app code writes it with the admin client.

do $$
begin
  if to_regprocedure('public.rls_notifiable_user_ids()') is null then
    raise exception 'apply 0065_c7b_additive_telemetry_labels_helpers.sql first';
  end if;
end $$;

drop policy if exists "system creates notifications from operational actions" on public.notifications;
create policy "members create notifications for self staff or related users" on public.notifications
  for insert with check (
    organization_id = (select current_organization_id())
    and (
      user_id = (select auth.uid())
      or (select current_user_role()) in ('fleet_manager', 'administrator', 'security', 'maintenance_operator')
      or user_id in (select rls_notifiable_user_ids())
    )
  );

create function public.notifications_guard_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- only direct inserts made with a user JWT (invoker functions included); definer functions and the
  -- service role run as another database role.
  if current_user = 'authenticated'
     and new.user_id is distinct from auth.uid()
     and coalesce(public.current_user_role()::text, '') not in ('fleet_manager', 'administrator', 'security', 'maintenance_operator')
  then
    if new.entity_type is not null or new.entity_id is not null
       or length(coalesce(new.body, '')) > 1000
       or not (
            (new.title = 'Nova reserva aguardando aprovação'
              and new.body like 'Uma nova viagem para %' and new.body like '% aguarda aprovação.')
         or (new.title = 'Pedido de carona na sua viagem'
              and new.body like 'Alguém pediu para participar da sua viagem para %'
              and new.body like '%. Acesse os detalhes da reserva para aceitar ou recusar.')
       ) then
      raise exception 'notification not allowed for this sender' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.notifications_guard_insert() from public, anon, authenticated;

create trigger notifications_guard_insert_trg
  before insert on public.notifications
  for each row execute function public.notifications_guard_insert();
