-- "Waiting for approval" notifications stayed unread (and looked current) after the reservation was approved, rejected or cancelled.
-- When a reservation leaves 'pending_approval', the notifications that announced it are marked as read. The manager notification is linked
-- (entity_type 'approval', entity_id = reservation); the older "Nova reserva aguardando aprovação" has no link but is created in the same
-- transaction as the reservation, so it is matched by organization + created_at.
create or replace function public.fm_close_pending_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'pending_approval' and new.status is distinct from 'pending_approval' then
    update public.notifications n
       set read_at = coalesce(n.read_at, now())
     where n.read_at is null
       and n.organization_id = new.organization_id
       and ((n.title = 'Reserva aguardando sua aprovação' and n.entity_type = 'approval' and n.entity_id = new.id)
         or (n.title = 'Nova reserva aguardando aprovação' and n.created_at = new.created_at));
  end if;
  return new;
end;
$$;

revoke all on function public.fm_close_pending_notifications() from public, anon, authenticated;

drop trigger if exists fm_close_pending_notifications on public.reservations;
create trigger fm_close_pending_notifications
  after update of status on public.reservations
  for each row execute function public.fm_close_pending_notifications();

-- one-time: close the ones whose reservation is no longer pending (decided or deleted)
update public.notifications n
   set read_at = now()
 where n.read_at is null
   and n.title in ('Reserva aguardando sua aprovação', 'Nova reserva aguardando aprovação')
   and not exists (
     select 1 from public.reservations r
      where r.status = 'pending_approval' and r.organization_id = n.organization_id
        and (r.id = n.entity_id or r.created_at = n.created_at));
