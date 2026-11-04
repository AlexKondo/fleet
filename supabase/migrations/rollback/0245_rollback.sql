-- back to 0243 (the decision rewrites the request notification instead of adding its own). The rows already changed stay as they are;
-- the rewritten originals are in public.zz_backup_notifications_2026_11_04 (the rows 0243 had rewritten, before 0245).
create or replace function public.fm_close_pending_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_actor text; v_dest text; v_title text; v_verb text;
begin
  if old.status = 'pending_approval' and new.status is distinct from 'pending_approval' then
    select p.full_name into v_actor from public.profiles p
     where p.id = case when new.status = 'cancelled' then coalesce(new.cancelled_by, new.approved_by) else new.approved_by end;
    select t.destination into v_dest from public.trip_requests t where t.id = new.trip_request_id;
    v_verb := case when new.status = 'cancelled' then 'cancelada' else 'aprovada' end;
    v_title := 'Reserva ' || v_verb || coalesce(' por ' || v_actor, '');
    update public.notifications n
       set title = v_title,
           body = left('Viagem para ' || coalesce(v_dest, '—') || ': reserva ' || v_verb || coalesce(' por ' || v_actor, '') || '.', 500)
     where n.organization_id = new.organization_id
       and ((n.title = 'Reserva aguardando sua aprovação' and n.entity_type = 'approval' and n.entity_id = new.id)
         or (n.title = 'Nova reserva aguardando aprovação' and n.created_at = new.created_at));
  end if;
  return new;
end;
$$;
