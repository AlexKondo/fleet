-- Rollback for 0067_m2_notifications_insert_policy.sql: restores the org-only INSERT policy (spoofable again).
drop trigger if exists notifications_guard_insert_trg on public.notifications;
drop function if exists public.notifications_guard_insert();
drop policy if exists "members create notifications for self staff or related users" on public.notifications;
create policy "system creates notifications from operational actions" on public.notifications
  for insert with check (organization_id = (select current_organization_id()));
