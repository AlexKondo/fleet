-- back to 0242 (delete on decision)
create or replace function public.fm_close_pending_notifications()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status = 'pending_approval' and new.status is distinct from 'pending_approval' then
    delete from public.notifications n where n.organization_id = new.organization_id
       and ((n.title = 'Reserva aguardando sua aprovação' and n.entity_type = 'approval' and n.entity_id = new.id)
         or (n.title = 'Nova reserva aguardando aprovação' and n.created_at = new.created_at));
  end if;
  return new;
end;
$$;
