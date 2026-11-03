-- 0241 only marked the "waiting for approval" notifications as read: they stayed in the bell with a text that is no longer true.
-- Once the reservation is decided (or gone) they are removed instead.
create or replace function public.fm_close_pending_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'pending_approval' and new.status is distinct from 'pending_approval' then
    delete from public.notifications n
     where n.organization_id = new.organization_id
       and ((n.title = 'Reserva aguardando sua aprovação' and n.entity_type = 'approval' and n.entity_id = new.id)
         or (n.title = 'Nova reserva aguardando aprovação' and n.created_at = new.created_at));
  end if;
  return new;
end;
$$;

delete from public.notifications n
 where n.title in ('Reserva aguardando sua aprovação', 'Nova reserva aguardando aprovação')
   and not exists (
     select 1 from public.reservations r
      where r.status = 'pending_approval' and r.organization_id = n.organization_id
        and (r.id = n.entity_id or r.created_at = n.created_at));
