-- restores the 0241 behaviour (mark as read); deleted notifications are not recoverable except from the backup taken before applying
create or replace function public.fm_close_pending_notifications()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status = 'pending_approval' and new.status is distinct from 'pending_approval' then
    update public.notifications n set read_at = coalesce(n.read_at, now())
     where n.read_at is null and n.organization_id = new.organization_id
       and ((n.title = 'Reserva aguardando sua aprovação' and n.entity_type = 'approval' and n.entity_id = new.id)
         or (n.title = 'Nova reserva aguardando aprovação' and n.created_at = new.created_at));
  end if;
  return new;
end;
$$;
