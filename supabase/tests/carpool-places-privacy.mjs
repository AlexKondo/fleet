#!/usr/bin/env node
// 0064: coarse address before acceptance, exact after, only for the host; direct column reads refused.
import { sql, rest, rpc, provisionOrg, signInAll, cleanupOrgs, record, summary, q } from './lib/live.mjs';
const orgs = [];
async function main() {
  // coarse label table (pure SQL function, run as postgres)
  const cases = [
    ['Av. Paulista, 1000 - Bela Vista, São Paulo - SP, 01310-100, Brasil', 'Av. Paulista, Bela Vista'],
    ['Rua Augusta, 1500 - Consolação, São Paulo - SP, 01304-001, Brazil', 'Rua Augusta, Consolação'],
    ['Rua do Rider 10, Sao Paulo', 'Rua do Rider, Sao Paulo'],
    ['Avenida Brasil 1500', 'Avenida Brasil'],
    ['Rua 25 de Março, 100', 'Rua 25 de Março'],
    ['1600 Pennsylvania Ave NW, Washington, DC 20500', 'Pennsylvania Ave NW, Washington'],
    ['Fábrica GWM, Iracemápolis - SP, Brasil', 'Fábrica GWM, Iracemápolis'],
    ['-23.55, -46.63', null],
    ['', null],
  ];
  for (const [input, want] of cases) {
    const [r] = await sql(`select carpool_coarse_label(${q(input)}) v`);
    record(`coarse(${JSON.stringify(input)}) = ${JSON.stringify(want)}`, r.v === want, r.v);
  }
  const A = await provisionOrg('P', [['host', 'employee'], ['rider', 'employee'], ['other', 'employee'], ['mgr', 'fleet_manager']], 1);
  orgs.push(A);
  await signInAll(A);
  const U = A.users;
  const [t] = await sql(`insert into trip_requests (organization_id, requester_id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, justification) values ('${A.orgId}','${U.host.id}', now()+interval '1 day', now()+interval '1 day 4 hours','O','D',10,1,'j') returning id`);
  const [o] = await sql(`insert into carpool_offers (organization_id, trip_request_id, host_id, status, seats_offered, seats_available, policy_version) values ('${A.orgId}','${t.id}','${U.host.id}','active',2,2,1) returning id`);
  const full = 'Av. Paulista, 1000 - Bela Vista, São Paulo - SP, 01310-100, Brasil';
  const [rr] = await sql(`insert into carpool_ride_requests (organization_id, carpool_offer_id, rider_id, requested_seats, pickup_location, dropoff_location, requested_departure_at, status, policy_version) values ('${A.orgId}','${o.id}','${U.rider.id}',1, ${q(JSON.stringify({ label: full, coordinates: { lat: -23.5, lng: -46.6 } }))}::jsonb, ${q(JSON.stringify({ label: 'Rua Augusta, 1500 - Consolação, São Paulo - SP' }))}::jsonb, now()+interval '1 day','PENDING',1) returning id`);
  const pend = await rpc(U.host.token, 'host_ride_request_places', { p_trip_request_id: t.id });
  const p0 = pend.body?.[0];
  record('PENDING: host gets COARSE labels (no number, no CEP, no coordinates), is_exact=false',
    pend.ok && pend.body.length === 1 && p0.pickup_label === 'Av. Paulista, Bela Vista' && p0.dropoff_label === 'Rua Augusta, Consolação' && p0.is_exact === false && !/\d/.test(p0.pickup_label + p0.dropoff_label) && !('pickup_location' in p0), JSON.stringify(p0));
  await sql(`update carpool_ride_requests set status='ACCEPTED' where id='${rr.id}'`);
  const acc = await rpc(U.host.token, 'host_ride_request_places', { p_trip_request_id: t.id });
  record('ACCEPTED: host gets the FULL stored labels, is_exact=true', acc.ok && acc.body[0].pickup_label === full && acc.body[0].is_exact === true, JSON.stringify(acc.body[0]));
  await sql(`update carpool_ride_requests set status='REJECTED' where id='${rr.id}'`);
  const rej = await rpc(U.host.token, 'host_ride_request_places', { p_trip_request_id: t.id });
  record('REJECTED: no places returned', rej.ok && rej.body[0].pickup_label === null && rej.body[0].dropoff_label === null, JSON.stringify(rej.body[0]));
  await sql(`update carpool_ride_requests set status='ACCEPTED' where id='${rr.id}'`);
  for (const who of ['rider', 'other', 'mgr']) {
    const r = await rpc(U[who].token, 'host_ride_request_places', { p_trip_request_id: t.id });
    record(`${who} (not the host) gets ZERO rows from host_ride_request_places`, r.ok && r.body.length === 0, JSON.stringify(r.body));
  }
  const an = await rpc(null, 'host_ride_request_places', { p_trip_request_id: t.id });
  record('anon denied', !an.ok, String(an.status));
  const coarseDirect = await rpc(U.host.token, 'carpool_coarse_label', { p_label: 'x' });
  record('carpool_coarse_label is not callable by users', !coarseDirect.ok, String(coarseDirect.status));
  for (const who of ['host', 'rider', 'mgr']) {
    for (const col of ['pickup_location', 'dropoff_location', 'host_origin_snapshot', 'host_destination_snapshot']) {
      const r = await rest(U[who].token, 'GET', `carpool_ride_requests?select=id,${col}&id=eq.${rr.id}`);
      record(`${who}: direct read of carpool_ride_requests.${col} refused`, r.status === 403, String(r.status));
    }
    const ok = await rest(U[who].token, 'GET', `carpool_ride_requests?select=id,status,rider_id&id=eq.${rr.id}`);
    record(`${who}: non-sensitive columns still readable`, ok.status === 200 && ok.body.length === 1, String(ok.status));
  }
}
main().catch((e) => record('FATAL', false, String(e.stack || e))).finally(async () => {
  await cleanupOrgs(orgs);
  process.exitCode = summary('carpool-places-privacy') > 0 ? 1 : 0;
});
