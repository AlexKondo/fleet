-- One-time backfill: 0050 fixed approve_reservation/cancel_reservation to populate
-- entity_type/entity_id on every NEW notification, but rows created before that migration
-- have no such column to backfill from directly — matched here by the same user plus a
-- tight timestamp match against when that reservation was actually approved/cancelled
-- (both happen in the same transaction as the notification insert, so the timestamps are
-- for all purposes identical). A user with two reservations approved/cancelled within the
-- same second could match the wrong one, but that's an edge case with no way to tell apart
-- retroactively and quietly leaving the notification unlinked (the prior behavior for
-- every row) is worse than a rare mismatch.
update notifications n
set entity_type = 'reservation', entity_id = r.id
from reservations r
join trip_requests tr on tr.id = r.trip_request_id
where n.title = 'Reserva aprovada'
  and n.entity_type is null
  and tr.requester_id = n.user_id
  and r.approved_at is not null
  and abs(extract(epoch from (r.approved_at - n.created_at))) < 5;

update notifications n
set entity_type = 'reservation', entity_id = r.id
from reservations r
join trip_requests tr on tr.id = r.trip_request_id
where n.title = 'Reserva cancelada'
  and n.entity_type is null
  and tr.requester_id = n.user_id
  and r.cancelled_at is not null
  and abs(extract(epoch from (r.cancelled_at - n.created_at))) < 5;
