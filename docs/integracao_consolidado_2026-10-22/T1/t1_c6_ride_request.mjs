// C6: "pedir carona" pelo caminho canonico do app (app/carpool/requestActions.ts -> create_carpool_ride_request_as_rider via
// service_role com p_rider_id = usuario da sessao). Verifica que a CNH NAO bloqueia o passageiro no banco.
// (A busca/rota do servidor - Google - nao existe localmente; as medidas de desvio sao fornecidas como 0.)
import crypto from 'node:crypto';
import { loadEnv, loadCreds, Api, sql, summarize } from './t1_lib.mjs';
const [envPath, credsPath] = process.argv.slice(2);
const api = new Api(loadEnv(envPath), loadCreds(credsPath));
const [[offer, dep]] = sql(`select o.id, t.departure_at from carpool_offers o join trip_requests t on t.id=o.trip_request_id where t.id=(select trip_request_id from reservations where id=t1.rid('host'))`);
const out = [];
for (const k of ['t1emp', 't1drvexp', 't1drvnull', 't1adminnocnh', 't1custcp', 't1drvb']) {
  const rider = sql(`select t1.uid('${k}')`)[0][0];
  const r = await api.rpc('service', 'create_carpool_ride_request_as_rider', { p_rider_id: rider, p_offer_id: offer, p_seats: 1, p_pickup: { coordinates: { lat: -23.55, lng: -46.63 }, source: 'manual_lat_lng' }, p_dropoff: { coordinates: { lat: -23.56, lng: -46.64 }, source: 'manual_lat_lng' }, p_requested_departure_at: new Date(dep).toISOString(), p_client_request_id: crypto.randomUUID(), p_match_additional_distance_km: 0, p_match_additional_time_min: 0 });
  out.push({ rider: k, ...summarize(r), body: typeof r.body === 'string' ? r.body : r.body });
}
const legacy = [];
for (const k of ['t1custcp']) {
  const hostTrip = sql(`select trip_request_id from reservations where id=t1.rid('host')`)[0][0];
  const r = await api.rpc(k, 'create_carpool_participation', { p_departure_at: dep, p_expected_return_at: new Date(Date.parse(dep) + 3 * 36e5).toISOString(), p_origin: 'T1', p_destination: 'T1', p_distance_km: 30, p_passenger_count: 1, p_requires_cargo: false, p_justification: 'T1 controle CNH valida', p_existing_trip_request_id: hostTrip });
  legacy.push({ actor: k, cnh: 'valida', ...summarize(r) });
}
console.log(JSON.stringify({ offer, canonical_ride_request: out, legacy_create_carpool_participation_control: legacy }, null, 1));
