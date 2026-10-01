#!/usr/bin/env node
// C7b holistic RBAC matrix for the carpool surface: every RPC and table (PostgREST, REAL user JWTs against the live
// project) x roles. Server actions / API routes are covered by testing/chat-carpool/rbac-actions.live.test.ts and the
// browser regression; the combined, printed matrix is assembled in the Phase Report.
//
//   node supabase/tests/carpool-rbac-matrix.mjs
//
// Roles (columns): anon, host (employee who owns the trip/offer), rider (employee with a request on the offer),
// stranger (unrelated employee of the same org), sec (security), mgr (fleet_manager), adm (administrator),
// mnt (maintenance_operator), other (employee of ANOTHER org), svc (service role = admin client, reference column).
// Cell = ACTUAL outcome ("Y" = authorised / data returned, "." = refused / nothing returned); a "!" marks a
// mismatch with the expectation derived from the design (pack 06 + migrations 0059-0064).
import { randomUUID } from 'node:crypto';
import { sql, rest, rpc, provisionOrg, signInAll, cleanupOrgs, record, summary, SVC, T } from './lib/live.mjs';

const PENDING = { M1: false, S1: false, STRICT: process.argv.includes('--pending-applied') };
let knownOpenCount = 0;
async function detectPending() {
  const m1 = await sql("select (prosrc not ilike '%''PENDING''%') ok from pg_proc where proname='rls_visible_trip_request_ids' and pronamespace='public'::regnamespace");
  PENDING.M1 = m1[0]?.ok === true;
  const s1 = await sql("select has_function_privilege('anon', 'public.update_member_role(uuid, uuid, user_role)', 'execute') a");
  PENDING.S1 = s1[0]?.a === false;
  if (PENDING.STRICT) { PENDING.M1 = true; PENDING.S1 = true; }
  console.log('pending migration 0068 (S1): ' + (PENDING.S1 ? 'APPLIED (strict)' : 'not applied (S1 cells marked ~ differ until it is)') + (PENDING.STRICT ? ' [--pending-applied: strict]' : ''));
  console.log('pending migration 0066 (M1): ' + (PENDING.M1 ? 'APPLIED (strict)' : 'not applied (cells marked ~ are expected to differ until it is)'));
}
const ROLES = ['anon', 'host', 'rider', 'stranger', 'sec', 'mgr', 'adm', 'mnt', 'other', 'svc'];
const orgs = [];
let n = 0;

async function main() {
  await detectPending();
  const A = await provisionOrg('R', [['host', 'employee'], ['rider', 'employee'], ['stranger', 'employee'], ['sec', 'security'], ['mgr', 'fleet_manager'], ['adm', 'administrator'], ['mnt', 'maintenance_operator']], 2);
  orgs.push(A);
  const B = await provisionOrg('S', [['other', 'employee']], 1);
  orgs.push(B);
  await signInAll(A); await signInAll(B);
  const tok = { anon: null, host: A.users.host.token, rider: A.users.rider.token, stranger: A.users.stranger.token, sec: A.users.sec.token, mgr: A.users.mgr.token, adm: A.users.adm.token, mnt: A.users.mnt.token, other: B.users.other.token, svc: SVC };
  await sql(`insert into carpool_policy_settings (organization_id, policy_version, departure_window_minutes, return_window_minutes, max_additional_distance_km, max_additional_time_minutes, request_expiry_minutes) values ('${A.orgId}', 1, 15, 15, 5, 15, 30)`);

  /** One SQL call creating a fresh host trip (+ reservation) and optionally an active offer and a PENDING request by `rider`. */
  async function fresh(kind) {
    n += 1;
    const h = 200 + n * 8;
    const [r] = await sql(`with t as (insert into trip_requests (organization_id, requester_id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, requires_cargo, justification, allow_carpool)
        values ('${A.orgId}', '${A.users.host.id}', now() + interval '${h} hours', now() + interval '${h + 4} hours', 'Origem RBAC', 'Destino RBAC', 10, 1, false, 'rbac', true) returning id, departure_at),
      rs as (insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at) select '${A.orgId}', '${A.vehicles[n % 2].id}', t.id, 'confirmed', now() + interval '${h} hours', now() + interval '${h + 4} hours' from t returning id),
      o as (insert into carpool_offers (organization_id, trip_request_id, host_id, status, seats_offered, seats_available, policy_version) select '${A.orgId}', t.id, '${A.users.host.id}', 'active', 3, 3, 1 from t where ${kind !== 'trip'} returning id),
      q as (insert into carpool_ride_requests (organization_id, carpool_offer_id, rider_id, requested_seats, pickup_location, dropoff_location, requested_departure_at, status, policy_version, match_additional_distance_km, match_additional_time_min)
        select '${A.orgId}', o.id, '${A.users.rider.id}', 1, '{"label":"Rua Rider 10","coordinates":{"lat":-23.55,"lng":-46.63}}', '{"label":"Av Destino 20","coordinates":{"lat":-23.56,"lng":-46.64}}', t.departure_at, 'PENDING', 1, 1, 2 from o, t where ${kind === 'pending'} returning id)
      select (select id from t) trip, (select id from o) offer, (select id from q) req, (select departure_at from t) dep, (select count(*) from rs) rs`);
    return r;
  }

  const matrix = []; // { group, endpoint, expectedAllowed:Set, actual:{role:boolean} }
  const mgrs = ['mgr', 'adm', 'svc'];
  async function probeRpc(endpoint, kind, fn, argsOf, allowed, extra = {}) {
    const actual = {};
    for (const role of ROLES) {
      const st = kind ? await fresh(kind) : {};
      const r = await rpc(tok[role], fn, argsOf(st, role), role === 'svc' ? SVC : undefined);
      let ok = r.ok;
      if (ok && extra.rowsMeansAllowed) ok = Array.isArray(r.body) && r.body.length > 0;
      // permissionOnly: the function was EXECUTED if the failure is a business-rule error, refused only on a permission error
      if (extra.permissionOnly) ok = r.ok || !(r.status === 401 || r.status === 403 || /42501|permission denied/i.test(JSON.stringify(r.body)));
      actual[role] = ok;
      if (!ok && allowed.includes(role) && process.env.RBAC_DEBUG) console.log('   DEBUG', endpoint, role, r.status, JSON.stringify(r.body).slice(0, 160));
    }
    matrix.push({ group: extra.group ?? 'RPC', endpoint, allowed, actual, pendingFix: extra.pendingTag ? Object.fromEntries(ROLES.map((r) => [r, extra.pendingTag])) : {} });
  }

  const uuid = () => randomUUID();
  const forged = '00000000-0000-4000-8000-00000000f0f0';
  // ---- offer lifecycle (host or fleet_manager / administrator)
  await probeRpc('enable_carpool_offer', 'trip', 'enable_carpool_offer', (s) => ({ p_trip_request_id: s.trip, p_seats: 2 }), ['host', 'mgr', 'adm']);
  await probeRpc('update_carpool_offer', 'offer', 'update_carpool_offer', (s) => ({ p_offer_id: s.offer, p_seats: 2 }), ['host', 'mgr', 'adm']);
  await probeRpc('disable_carpool_offer', 'offer', 'disable_carpool_offer', (s) => ({ p_offer_id: s.offer }), ['host', 'mgr', 'adm']);
  await probeRpc('revalidate_carpool_matches', 'offer', 'revalidate_carpool_matches', (s) => ({ p_trip_request_id: s.trip }), ['host', 'mgr', 'adm']);
  // ---- request lifecycle
  await probeRpc('accept_carpool_ride_request', 'pending', 'accept_carpool_ride_request', (s) => ({ p_request_id: s.req }), ['host', 'mgr', 'adm']);
  await probeRpc('reject_carpool_ride_request', 'pending', 'reject_carpool_ride_request', (s) => ({ p_request_id: s.req, p_reason: 'rbac test' }), ['host', 'mgr', 'adm']);
  await probeRpc('cancel_carpool_ride_request', 'pending', 'cancel_carpool_ride_request', (s) => ({ p_request_id: s.req }), ['rider', 'mgr', 'adm']);
  // ---- host places view: rows only for the host of the offer
  await probeRpc('host_ride_request_places', 'pending', 'host_ride_request_places', (s) => ({ p_trip_request_id: s.trip }), ['host'], { rowsMeansAllowed: true });
  // ---- server-only functions: nobody but the service role
  const mk = (s) => ({ p_rider_id: A.users.rider.id, p_offer_id: s.offer, p_seats: 1, p_pickup: { label: 'x', coordinates: { lat: -23.55, lng: -46.63 } }, p_dropoff: { label: 'y', coordinates: { lat: -23.56, lng: -46.64 } }, p_requested_departure_at: s.dep, p_client_request_id: uuid(), p_match_additional_distance_km: 1, p_match_additional_time_min: 2 });
  await probeRpc('create_carpool_ride_request_as_rider (server-only)', 'offer', 'create_carpool_ride_request_as_rider', mk, ['svc']);
  await probeRpc('expire_stale_carpool_requests (cron, server-only)', null, 'expire_stale_carpool_requests', () => ({}), ['svc']);
  await probeRpc('carpool_policy_for_org (internal)', null, 'carpool_policy_for_org', () => ({ p_org: A.orgId }), ['svc']);
  await probeRpc('carpool_notify_user (internal)', null, 'carpool_notify_user', () => ({ p_org: A.orgId, p_user: A.users.host.id, p_title: 'spoof', p_body: 'spoof', p_entity_id: null, p_group: false }), ['svc']);
  await probeRpc('carpool_emit_event (internal)', null, 'carpool_emit_event', () => ({ p_organization_id: A.orgId, p_event_type: 'RideAccepted', p_offer_id: null, p_request_id: null, p_trip_request_id: null, p_actor_id: null, p_payload: {} }), ['svc']);
  await probeRpc('carpool_revalidate_trip (internal)', null, 'carpool_revalidate_trip', () => ({ p_trip_request_id: forged, p_actor_id: null, p_changed_fields: ['x'] }), ['svc']);
  await probeRpc('carpool_apply_accept (internal)', 'pending', 'carpool_apply_accept', (s) => ({ p_request_id: s.req, p_actor_id: A.users.host.id, p_auto: false }), ['svc']);
  await probeRpc('carpool_invalidate_request (internal)', null, 'carpool_invalidate_request', () => ({ p_request_id: forged, p_reason: 'x', p_actor_id: null }), ['svc']);
  await probeRpc('carpool_recompute_seats (internal)', null, 'carpool_recompute_seats', () => ({ p_offer_id: forged }), ['svc']);
  await probeRpc('carpool_seats_taken / free_seats / host_trip_is_active (internal)', null, 'carpool_seats_taken', () => ({ p_offer_id: forged }), ['svc']);
  await probeRpc('record_geo_provider_call_outcome (Cost Guard)', null, 'record_geo_provider_call_outcome', () => ({ p_organization_id: A.orgId, p_provider_call_kind: 'routing', p_day: '2026-01-01', p_ok: true, p_latency_ms: 1 }), ['svc']);
  await probeRpc('increment_geo_provider_quota_counter (Cost Guard)', null, 'increment_geo_provider_quota_counter', () => ({ p_organization_id: A.orgId, p_provider_call_kind: 'routing', p_day: '2026-01-01' }), ['svc']);

  // ---- S1 (pending 0068): internal SECURITY DEFINER functions must be service-role only. Until 0068 is applied every role can call
  // them (the Critical finding): those cells are KNOWN-OPEN and flip to strict failures with --pending-applied / once applied.
  const ownOrg = { p_organization_id: A.orgId };
  await probeRpc('update_member_role (S1)', null, 'update_member_role', () => ({ ...ownOrg, p_user_id: A.users.stranger.id, p_new_role: 'employee' }), ['svc'], { pendingTag: 'S1', group: 'RPC-S1' });
  await probeRpc('lock_and_require_multiple_administrators (S1)', null, 'lock_and_require_multiple_administrators', () => ownOrg, ['svc'], { pendingTag: 'S1', group: 'RPC-S1', permissionOnly: true });
  await probeRpc('auto_reassign_reservation_vehicle (S1)', null, 'auto_reassign_reservation_vehicle', () => ({ ...ownOrg, p_reservation_id: forged, p_new_vehicle_id: forged }), ['svc'], { pendingTag: 'S1', group: 'RPC-S1', permissionOnly: true });
  await probeRpc('rls_auto_enable (S1)', null, 'rls_auto_enable', () => ({}), ['svc'], { pendingTag: 'S1', group: 'RPC-S1', permissionOnly: true });
  // log_audit_event keeps authenticated (own actor + org enforced inside); anon loses it with 0068
  await probeRpc('log_audit_event (S1: anon denied, signed-in own org allowed)', null, 'log_audit_event', (_s, role) => ({ ...ownOrg, p_actor_id: role === 'anon' || role === 'svc' ? A.users.adm.id : (role === 'other' ? B.users.other.id : A.users[role].id), p_action: 'rbac_probe', p_entity_type: 'rbac', p_entity_id: null, p_before: null, p_after: null }), ['host', 'rider', 'stranger', 'sec', 'mgr', 'adm', 'mnt', 'svc'], { pendingTag: 'S1', group: 'RPC-S1' });

  // ---- tables (PostgREST). Seed one row of each telemetry/ops table.
  const day = new Date().toISOString().slice(0, 10);
  await rpc(SVC, 'increment_geo_provider_quota_counter', { p_organization_id: A.orgId, p_provider_call_kind: 'routing', p_day: day }, SVC);
  await sql(`insert into carpool_search_log (organization_id, user_id, source, outcome) values ('${A.orgId}', '${A.users.rider.id}', 'web', 'none')`);
  await sql(`insert into corporate_mobility_points (organization_id, name, address_label, latitude, longitude) values ('${A.orgId}', 'Portaria RBAC', 'Av Teste 1, São Paulo', -23.55, -46.63)`);
  const st = await fresh('pending');
  await sql(`insert into carpool_events (organization_id, event_type, carpool_offer_id, trip_request_id) values ('${A.orgId}', 'CarpoolOfferEnabled', '${st.offer}', '${st.trip}')`);

  async function probeSelect(table, allowed, pendingFix = {}) {
    const actual = {};
    for (const role of ROLES) {
      const r = role === 'svc' ? await rest(SVC, 'GET', `${table}?select=id&limit=5`) : await rest(tok[role], 'GET', `${table}?select=id&limit=5`);
      actual[role] = Array.isArray(r.body) && r.body.length > 0;
    }
    matrix.push({ group: 'TABLE read', endpoint: table, allowed, actual, pendingFix });
  }
  await probeSelect('carpool_offers', ['host', 'mgr', 'adm', 'svc'], { rider: 'M1' }); // 'rider' has only a PENDING request: sees none once 0066 is applied
  await probeSelect('carpool_ride_requests', ['host', 'rider', 'mgr', 'adm', 'svc']);
  await probeSelect('carpool_events', ['mgr', 'adm', 'svc']);
  await probeSelect('carpool_policy_settings', ['host', 'rider', 'stranger', 'sec', 'mgr', 'adm', 'mnt', 'svc']);
  await probeSelect('geo_provider_quota_counters', ['mgr', 'adm', 'svc']);
  await probeSelect('carpool_search_log', ['mgr', 'adm', 'svc']);
  await probeSelect('corporate_mobility_points', ['host', 'rider', 'stranger', 'sec', 'mgr', 'adm', 'mnt', 'svc']);

  async function probeWrite(label, table, body, allowed, cleanup) {
    const actual = {};
    for (const role of ROLES) {
      const r = role === 'svc' ? await rest(SVC, 'POST', table, body(role)) : await rest(tok[role], 'POST', table, body(role));
      actual[role] = r.status < 300;
      if (actual[role] && cleanup) await cleanup(r.body);
    }
    matrix.push({ group: 'TABLE insert', endpoint: label, allowed, actual });
  }
  const offerBody = () => ({ organization_id: A.orgId, trip_request_id: st.trip, host_id: A.users.host.id, status: 'active', seats_offered: 9, seats_available: 9, policy_version: 1 });
  await probeWrite('carpool_offers INSERT (publish seats directly)', 'carpool_offers', offerBody, ['svc'], async (b) => { if (b?.[0]?.id) await sql(`delete from carpool_offers where id='${b[0].id}'`); });
  await probeWrite('carpool_ride_requests INSERT (forge a request)', 'carpool_ride_requests', (role) => ({ organization_id: A.orgId, carpool_offer_id: st.offer, rider_id: A.users.stranger.id, requested_seats: 1, requested_departure_at: new Date().toISOString(), status: 'ACCEPTED', policy_version: 1, client_request_id: uuid() }), ['svc'], async (b) => { if (b?.[0]?.id) await sql(`delete from carpool_ride_requests where id='${b[0].id}'`); });
  await probeWrite('carpool_events INSERT (forge audit event)', 'carpool_events', () => ({ organization_id: A.orgId, event_type: 'RideAccepted', payload: {} }), ['svc'], async (b) => { if (b?.[0]?.id) await sql(`delete from carpool_events where id='${b[0].id}'`); });
  await probeWrite('carpool_search_log INSERT (forge telemetry)', 'carpool_search_log', () => ({ organization_id: A.orgId, source: 'web', outcome: 'none' }), ['svc'], async (b) => { if (b?.[0]?.id) await sql(`delete from carpool_search_log where id='${b[0].id}'`); });
  await probeWrite('geo_provider_quota_counters INSERT (tamper Cost Guard)', 'geo_provider_quota_counters', () => ({ organization_id: A.orgId, provider_call_kind: 'geocode', day: '2026-02-02', call_count: 0 }), ['svc'], async (b) => { if (b?.[0]?.id) await sql(`delete from geo_provider_quota_counters where id='${b[0].id}'`); });
  let version = 100;
  await probeWrite('carpool_policy_settings INSERT (publish a policy version)', 'carpool_policy_settings', () => ({ organization_id: A.orgId, policy_version: ++version, departure_window_minutes: 15, return_window_minutes: 15, max_additional_distance_km: 5, max_additional_time_minutes: 10, request_expiry_minutes: 30 }), ['mgr', 'adm', 'svc'], async (b) => { if (b?.[0]?.id) await sql(`delete from carpool_policy_settings where id='${b[0].id}'`); });
  await probeWrite('corporate_mobility_points INSERT', 'corporate_mobility_points', () => ({ organization_id: A.orgId, name: 'Ponto ' + uuid().slice(0, 4), address_label: 'Av Teste 2, São Paulo', latitude: -23.5, longitude: -46.6 }), ['mgr', 'adm', 'svc'], async (b) => { if (b?.[0]?.id) await sql(`delete from corporate_mobility_points where id='${b[0].id}'`); });

  // ---- print + assert
  const w = 56;
  console.log('\nCarpool RBAC matrix (cell = ACTUAL: Y authorised / data, . refused / none; "!" = differs from the expected value; "~" = differs only until the pending migration 0066 is applied)');
  console.log('group'.padEnd(13) + 'endpoint'.padEnd(w) + ROLES.map((r) => r.padEnd(9)).join(''));
  let bad = 0;
  for (const m of matrix) {
    const cells = ROLES.map((role) => {
      const exp = m.allowed.includes(role);
      const act = m.actual[role];
      const ok = exp === act;
      const open = !ok && m.pendingFix?.[role] && !PENDING[m.pendingFix[role]];
      if (open) knownOpenCount += 1;
      if (!ok && !open) bad += 1;
      return ((act ? 'Y' : '.') + (ok ? '' : open ? '~' : '!')).padEnd(9);
    });
    console.log(m.group.padEnd(13) + m.endpoint.padEnd(w) + cells.join(''));
    for (const role of ROLES) {
      const exp = m.allowed.includes(role);
      const pass = exp === m.actual[role];
      const tag = m.pendingFix?.[role];
      if (!pass && tag && !PENDING[tag]) { console.log(`KNOWN-OPEN - ${m.group} ${m.endpoint} as ${role}: ${exp ? 'authorised' : 'refused'} [${tag}: pending migration not applied]`); continue; }
      record(`${m.group} ${m.endpoint} as ${role}: ${exp ? 'authorised' : 'refused'}${tag ? ' [' + tag + ']' : ''}`, pass);
    }
  }
  console.log(`KNOWN-OPEN cells (differ only until the pending migrations 0066/0068 are applied): ${knownOpenCount}`);
  console.log(`\n${matrix.length} endpoints x ${ROLES.length} roles = ${matrix.length * ROLES.length} cells, ${bad} mismatch(es).`);
  return { matrix };
}

main()
  .catch((err) => record('FATAL (unexpected exception)', false, String(err && err.stack ? err.stack : err)))
  .finally(async () => {
    await cleanupOrgs(orgs);
    process.exitCode = summary('carpool-rbac-matrix') > 0 ? 1 : 0;
    void T;
  });
