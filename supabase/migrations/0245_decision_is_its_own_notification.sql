-- 0243 rewrote the "waiting for approval" notification into "approved by ...": the history of the request was lost (one message where there were two events).
-- Every event is now its own notification: the request stays as it was, and the decision is a NEW notification ("Reserva aprovada por <name>" /
-- "Reserva cancelada por <name>") for the same people who were told about the request (never for the requester: the decision RPCs already send them their own).

-- Backup of the rows 0243 rewrote (they are changed back below)
create table if not exists public.zz_backup_notifications_2026_11_04 as
  select * from public.notifications where title ~ '^Reserva (aprovada|cancelada|recusada) por';

create or replace function public.fm_close_pending_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_actor text; v_dest text; v_title text; v_body text; v_verb text; v_requester uuid;
begin
  if old.status = 'pending_approval' and new.status is distinct from 'pending_approval' then
    select p.full_name into v_actor from public.profiles p
     where p.id = case when new.status = 'cancelled' then coalesce(new.cancelled_by, new.approved_by) else new.approved_by end;
    select t.destination, t.requester_id into v_dest, v_requester from public.trip_requests t where t.id = new.trip_request_id;
    v_verb := case when new.status = 'cancelled' then 'cancelada' else 'aprovada' end;
    v_title := 'Reserva ' || v_verb || coalesce(' por ' || v_actor, '');
    v_body := left('Viagem para ' || coalesce(v_dest, '—') || ': reserva ' || v_verb || coalesce(' por ' || v_actor, '') || '.', 500);
    insert into public.notifications (organization_id, user_id, title, body, entity_type, entity_id)
      select distinct on (n.user_id) new.organization_id, n.user_id, v_title, v_body, 'reservation', new.id
        from public.notifications n
       where n.organization_id = new.organization_id
         and n.user_id is distinct from v_requester
         and ((n.title = 'Reserva aguardando sua aprovação' and n.entity_type = 'approval' and n.entity_id = new.id)
           or (n.title = 'Nova reserva aguardando aprovação' and n.created_at = new.created_at));
  end if;
  return new;
end;
$$;
revoke all on function public.fm_close_pending_notifications() from public, anon, authenticated;

-- Backfill, 1/2: the decision as its own notification (what the rewritten row said, at the time of the decision)
with rw as (
  select b.*, coalesce(case when b.entity_type = 'approval' then b.entity_id end,
                       (select r.id from public.reservations r where r.organization_id = b.organization_id and r.created_at = b.created_at limit 1)) as rid
    from public.zz_backup_notifications_2026_11_04 b
)
insert into public.notifications (organization_id, user_id, title, body, read_at, created_at, entity_type, entity_id)
  select distinct on (rw.user_id, rw.rid) rw.organization_id, rw.user_id, rw.title, rw.body, rw.read_at,
         coalesce(r.approved_at, r.cancelled_at, rw.created_at), 'reservation', rw.rid
    from rw join public.reservations r on r.id = rw.rid
   where rw.rid is not null
   order by rw.user_id, rw.rid;

-- Backfill, 2/2: the request notifications get their own text back (the exact original when it was backed up in 0242, else rebuilt from the trip)
update public.notifications n
   set title = coalesce(o.title, case when b.entity_type = 'approval' then 'Reserva aguardando sua aprovação' else 'Nova reserva aguardando aprovação' end),
       body = coalesce(o.body, case when b.entity_type = 'approval'
              then left(coalesce(p.full_name, '—') || ' pediu um veículo para ' || coalesce(t.destination, '—') || '. Abra "Aprovar reservas" para decidir.', 500)
              else 'Uma nova viagem para ' || coalesce(t.destination, '—') || ' aguarda aprovação.' end)
  from public.zz_backup_notifications_2026_11_04 b
  left join public.zz_backup_notifications_2026_11_03 o on o.id = b.id
  left join public.reservations r on r.id = coalesce(case when b.entity_type = 'approval' then b.entity_id end,
                                      (select r2.id from public.reservations r2 where r2.organization_id = b.organization_id and r2.created_at = b.created_at limit 1))
  left join public.trip_requests t on t.id = r.trip_request_id
  left join public.profiles p on p.id = t.requester_id
 where n.id = b.id;
